import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function htmlText(value = "") {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&auml;/gi, "ä").replace(/&ouml;/gi, "ö").replace(/&uuml;/gi, "ü")
    .replace(/&Auml;/g, "Ä").replace(/&Ouml;/g, "Ö").replace(/&Uuml;/g, "Ü")
    .replace(/&szlig;/gi, "ß").replace(/&euro;/gi, "€")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

export function isExactModel(title, includeNew = false) {
  const text = htmlText(title).toUpperCase().replace(/[^A-Z0-9ÄÖÜ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!/\b(PANASONIC|LUMIX)\b/.test(text)) return false;
  if (/\b(S1\s*R|S5|S1\s*H|S1\s*II\s*E|S1\s*E)\b/.test(text)) return false;
  if (!/\bS1\s*(II|2|MK\s*2)\b/.test(text)) return false;
  if (/\b(SUCHE|GESUCHT|ANKAUF|MIETE|MIETEN|VERMIETUNG)\b/.test(text)) return false;
  const accessory = /\b(CAGE|RIG|AKKU|BATTERIE|LADEGERÄT|OBJEKTIV|LENS|ADAPTER|DISPLAYFOLIE|SCHUTZGLAS|GRIFF|HANDBUCH|BUCH|TASCHE)\b/;
  const camera = /\b(KAMERA|BODY|GEHÄUSE|VOLLFORMAT|SYSTEMKAMERA)\b/;
  if (accessory.test(text) && !camera.test(text)) return false;
  if (!includeNew && /\bNEU\b/.test(text) && !/\b(WIE NEU|NEUWERTIG)\b/.test(text)) return false;
  return true;
}

export function parsePrice(text = "") {
  const match = htmlText(text).match(/(?:€|EUR)\s*(\d{1,3}(?:[.\s]\d{3})*|\d+)(?:,\d{2})?|(?<!\d)(\d{1,3}(?:[.\s]\d{3})*|\d+)(?:,\d{2})?\s*(?:€|EUR)/i);
  if (!match) return null;
  return Number((match[1] || match[2]).replace(/[.\s]/g, ""));
}

const one = (text, regex, group = 1) => text.match(regex)?.[group] || "";

export function parseKleinanzeigen(html, config) {
  const cards = html.match(/<article\s+class="aditem"[\s\S]*?<\/article>/gi) || [];
  return cards.flatMap((body) => {
    const title = htmlText(one(body, /<a\s+class="ellipsis"[^>]*>([\s\S]*?)<\/a>/i));
    if (!isExactModel(title, config.includeNew)) return [];
    const price = parsePrice(htmlText(one(body, /class="[^"]*price[^"]*"[^>]*>([\s\S]*?)<\/p>/i)));
    if (price === null || price > config.maxPrice) return [];
    const href = one(body, /data-href="([^"]+)"/i);
    const id = one(body, /data-adid="(\d+)"/i);
    return [{
      id: `kleinanzeigen-${id}`, source: "Kleinanzeigen", title, price, shipping: null, totalPrice: price,
      location: htmlText(one(body, /aditem-main--top--left[^>]*>([\s\S]*?)<\/div>/i)),
      date: htmlText(one(body, /aditem-main--top--right[^>]*>([\s\S]*?)<\/div>/i)),
      description: htmlText(one(body, /aditem-main--middle--description[^>]*>([\s\S]*?)<\/p>/i)),
      url: href.startsWith("http") ? href : `https://www.kleinanzeigen.de${href}`,
      image: one(body, /"contentUrl"\s*:\s*"(https:[^"]+)"/i)
    }];
  });
}

export function parseEbay(html, config) {
  if (/<title>Error Page \| eBay<\/title>/i.test(html)) throw new Error("Automatischer Abruf momentan blockiert (HTTP 403)");
  const cards = html.match(/<li[^>]+class="[^"]*s-item[^"]*"[\s\S]*?<\/li>/gi) || [];
  return cards.flatMap((body) => {
    const link = body.match(/<a[^>]+class="[^"]*s-item__link[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) return [];
    const title = htmlText(one(link[2], /<(?:span|div)[^>]+class="[^"]*s-item__title[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/i));
    if (!isExactModel(title, config.includeNew)) return [];
    const price = parsePrice(htmlText(one(body, /s-item__price[^>]*>([\s\S]*?)<\/span>/i)));
    if (price === null || price > config.maxPrice) return [];
    const shippingText = htmlText(one(body, /s-item__shipping[^>]*>([\s\S]*?)<\/span>/i));
    const shipping = /kostenlos|gratis/i.test(shippingText) ? 0 : parsePrice(shippingText);
    const url = htmlText(link[1]).replace(/\?.*$/, "");
    return [{
      id: `ebay-${one(url, /\/itm\/(?:[^/]+\/)?(\d+)/i)}`, source: "eBay", title, price, shipping,
      totalPrice: price + (shipping || 0), location: htmlText(one(body, /s-item__location[^>]*>([\s\S]*?)<\/span>/i)),
      date: "", description: shippingText, url, image: one(body, /<img[^>]+src="(https:[^"]+)"/i)
    }];
  });
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "accept-language": "de-DE,de;q=0.9"
    }});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timeout); }
}

const esc = (value = "") => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

export function renderPage(payload, config) {
  const cards = payload.offers.map(o => `<article class="card">
    <a class="photo" href="${esc(o.url)}" target="_blank" rel="noopener">${o.image ? `<img src="${esc(o.image)}" alt="" loading="lazy">` : `<span>S1 II</span>`}</a>
    <div class="content"><div class="meta"><b>${esc(o.source)}</b><span>${esc(o.location)}</span></div>
    <h2><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title)}</a></h2>
    <div class="price">${o.price.toLocaleString("de-DE")} € ${o.shipping == null ? "" : `<small>${o.shipping ? `+ ${o.shipping.toLocaleString("de-DE")} € Versand` : "Versand kostenlos"}</small>`}</div>
    <p>${esc(o.description)}</p><time>${esc(o.date)}</time></div></article>`).join("\n");
  const errors = payload.errors.length ? `<aside><b>Quellenhinweis:</b> ${payload.errors.map(esc).join(" · ")}</aside>` : "";
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="1800"><title>Lumix S1 II Finder</title><style>
  :root{font-family:Inter,ui-sans-serif,system-ui;color:#17211d;background:#f3f5f1}*{box-sizing:border-box}body{margin:0}header{background:#17211d;color:#fff;padding:42px max(20px,calc((100% - 1000px)/2)) 32px}h1{font-size:clamp(30px,6vw,52px);margin:0 0 7px}header p{color:#bed0c6;margin:0}.wrap{max-width:1000px;margin:auto;padding:24px 20px}.summary{display:flex;justify-content:space-between;gap:12px;margin-bottom:18px;color:#607068}.summary b{color:#17211d}aside{background:#fff1d6;border:1px solid #e6bd65;padding:14px;border-radius:12px;margin-bottom:18px}.grid{display:grid;gap:15px}.card{display:grid;grid-template-columns:190px 1fr;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px #17211d12}.photo{background:#e5e9e5;min-height:155px;display:grid;place-items:center;font-size:28px;font-weight:800;color:#718078}.photo img{width:100%;height:100%;object-fit:cover}.content{padding:18px}.meta{display:flex;justify-content:space-between;color:#718078;font-size:13px}.meta b{color:#2d7452}h2{font-size:19px;margin:8px 0}a{color:inherit;text-decoration:none}h2 a:hover{text-decoration:underline}.price{font-size:25px;font-weight:800}.price small{font-size:13px;font-weight:400;color:#718078}.content p{color:#53615a;margin:8px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.content time{color:#718078;font-size:13px}.empty{background:#fff;padding:38px;border-radius:16px;text-align:center}@media(max-width:650px){.card{grid-template-columns:110px 1fr}.photo{min-height:180px}.content{padding:14px}.summary,.meta{display:block}.meta span{display:block;margin-top:3px}}
  </style></head><body><header><h1>Lumix S1 II Finder</h1><p>Nur das exakte Modell · gebraucht · Deutschland</p></header><main class="wrap"><div class="summary"><b>${payload.offers.length} passende Angebote</b><span>Aktualisiert: ${new Date(payload.updatedAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} Uhr · bis ${config.maxPrice.toLocaleString("de-DE")} €</span></div>${errors}<div class="grid">${cards || '<div class="empty">Aktuell keine passenden Angebote unter deiner Preisgrenze.</div>'}</div></main></body></html>`;
}

export async function generate({ fixtureDirectory } = {}) {
  const config = JSON.parse(await readFile(path.join(root, "config.json"), "utf8"));
  const sources = [
    ["Kleinanzeigen", "https://www.kleinanzeigen.de/s-foto/panasonic-lumix-s1-ii/k0c245", "kleinanzeigen.html", parseKleinanzeigen],
    ["Kleinanzeigen", "https://www.kleinanzeigen.de/s-foto/panasonic-lumix-s1/k0c245", "kleinanzeigen-breit.html", parseKleinanzeigen],
    ["eBay", "https://www.ebay.de/sch/i.html?_nkw=panasonic+lumix+s1+ii&_sacat=31388&LH_PrefLoc=1&LH_ItemCondition=3000&_sop=15", "ebay.html", parseEbay]
  ].filter(([name]) => config.sources[name === "Kleinanzeigen" ? "kleinanzeigen" : "ebay"]);
  const errors = [], offers = [];
  for (const [name, url, fixture, parser] of sources) {
    try {
      const file = fixtureDirectory && path.join(fixtureDirectory, fixture);
      if (file && fixture === "kleinanzeigen-breit.html") continue;
      const html = file ? await readFile(file, "utf8") : await fetchPage(url);
      offers.push(...parser(html, config));
    } catch (error) { errors.push(`${name}: ${error.message}`); }
  }
  const unique = [...new Map(offers.map(o => [o.id, o])).values()].sort((a, b) => a.totalPrice - b.totalPrice);
  const payload = { updatedAt: new Date().toISOString(), offers: unique, errors: [...new Set(errors)] };
  const publicDir = path.join(root, "public");
  await mkdir(publicDir, { recursive: true });
  await writeFile(path.join(publicDir, "angebote.json"), JSON.stringify(payload, null, 2));
  await writeFile(path.join(publicDir, "index.html"), renderPage(payload, config));
  await writeFile(path.join(publicDir, ".nojekyll"), "");
  return payload;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const payload = await generate();
  console.log(`${payload.offers.length} passende Angebote; ${payload.errors.length} Quellenhinweise.`);
}
