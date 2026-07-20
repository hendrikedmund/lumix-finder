import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function findNewOffers(current, previous) {
  const alreadySeen = new Set(previous?.seenIds || previous?.offers?.map(offer => offer.id) || []);
  return (current?.offers || []).filter(offer => offer.id && !alreadySeen.has(offer.id));
}

export function mergeSeenIds(current, previous) {
  return [...new Set([
    ...(previous?.seenIds || previous?.offers?.map(offer => offer.id) || []),
    ...(current?.offers || []).map(offer => offer.id)
  ].filter(Boolean))].slice(-2000);
}

export function normalizeTopic(value = "") {
  let topic = String(value).trim();
  if (/^https?:\/\//i.test(topic)) {
    const parsed = new URL(topic);
    topic = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) || "");
  }
  topic = topic.replace(/^\/+|\/+$/g, "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) {
    throw new Error("NTFY_TOPIC ist ungültig. Trage nur den Kanalnamen ein, z. B. lumix-a1b2c3d4 (keine Leerzeichen)."
    );
  }
  return topic;
}

async function ntfyError(response) {
  const detail = (await response.text()).trim();
  return new Error(`ntfy HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

async function getPrevious(url) {
  if (!url) return { offers: [], seenIds: [] };
  try {
    const response = await fetch(`${url}?t=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.log(`Vorherige Angebotsliste nicht abrufbar (${error.message}); es werden noch keine Pushs verschickt.`);
    return null;
  }
}

async function sendPush(offer, topic, server) {
  const response = await fetch(server, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic,
      title: "Neues Lumix S1 II Angebot",
      message: `${offer.price.toLocaleString("de-DE")} € · ${offer.source}\n${offer.title}`,
      click: offer.url,
      priority: 4,
      tags: ["camera", "moneybag"]
    })
  });
  if (!response.ok) throw await ntfyError(response);
}

async function sendTestPush(topic, server) {
  const response = await fetch(server, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic,
      title: "Lumix Finder ist verbunden",
      message: "Push-Benachrichtigungen funktionieren. Künftig meldet sich der Finder nur bei neuen Angeboten.",
      click: "https://hendrikedmund.github.io/lumix-finder/",
      priority: 3,
      tags: ["white_check_mark", "camera"]
    })
  });
  if (!response.ok) throw await ntfyError(response);
}

export async function notify() {
  const dataPath = path.join(root, "public", "angebote.json");
  const current = JSON.parse(await readFile(dataPath, "utf8"));
  const topicValue = process.env.NTFY_TOPIC?.trim();
  if (!topicValue) {
    console.log("NTFY_TOPIC ist nicht eingerichtet; Push-Benachrichtigungen werden übersprungen.");
    return { sent: 0, skipped: true };
  }
  const topic = normalizeTopic(topicValue);

  const server = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
  const testRequested = /^(?:1|true|yes)$/i.test(process.env.NTFY_TEST || "");
  if (testRequested) await sendTestPush(topic, server);

  const previous = await getPrevious(process.env.PREVIOUS_OFFERS_URL);
  if (previous === null) return { sent: testRequested ? 1 : 0, skipped: true };
  const newOffers = findNewOffers(current, previous);
  current.seenIds = mergeSeenIds(current, previous);
  await writeFile(dataPath, JSON.stringify(current, null, 2));

  for (const offer of newOffers.slice(0, 10)) await sendPush(offer, topic, server);
  console.log(`${newOffers.length} neue Angebote erkannt; ${Math.min(newOffers.length, 10)} Angebots-Pushs verschickt${testRequested ? "; Test-Push verschickt" : ""}.`);
  return { sent: Math.min(newOffers.length, 10) + (testRequested ? 1 : 0), skipped: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await notify();
}
