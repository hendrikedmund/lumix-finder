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
      id: `kleinanzeigen-${id}`, source: "Kleinanzeigen", title, price, shipping: null, totalPrice: price, condition: "Gebraucht/privat",
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
      totalPrice: price + (shipping || 0), location: htmlText(one(body, /s-item__location[^>]*>([\s\S]*?)<\/span>/i)), condition: "Gebraucht",
      date: "", description: shippingText, url, image: one(body, /<img[^>]+src="(https:[^"]+)"/i)
    }];
  });
}

function machinePrice(value = "") {
  const normalized = String(value).trim().replace(/\s/g, "");
  if (/^\d{1,5}\.\d{2}$/.test(normalized)) return Number(normalized);
  return parsePrice(`${normalized} EUR`);
}

export function parseProductPage(html, config, source, url) {
  const title = htmlText(
    one(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    one(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    one(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
  );
  if (!isExactModel(title, true)) return [];
  if (/outofstock|soldout|nicht\s+(?:mehr\s+)?verfügbar|derzeit\s+nicht\s+lieferbar/i.test(html) &&
      !/instock|sofort\s+lieferbar|auf\s+lager/i.test(html)) return [];

  const candidates = [
    one(html, /<meta[^>]+(?:itemprop=["']price["']|property=["'](?:product|og):price:amount["'])[^>]+content=["']([\d.,]+)["']/i),
    one(html, /<meta[^>]+content=["']([\d.,]+)["'][^>]+(?:itemprop=["']price["']|property=["'](?:product|og):price:amount["'])/i),
    one(html, /["'](?:lowPrice|price)["']\s*:\s*["']?([\d.]+(?:,\d{2})?)/i),
    one(html, /Sie\s+zahlen\s+(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i),
    one(html, /(?:ab\s*)?(?:€|&euro;|&#\d+;)\s*(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?)/i)
  ].filter(Boolean);
  const prices = candidates.map(machinePrice).filter(p => Number.isFinite(p) && p >= 500 && p <= 10_000);
  if (!prices.length) return [];
  // Candidates are ordered from structured product metadata to weaker text
  // fallbacks. Choosing the first valid one avoids unrelated accessory prices.
  const price = prices[0];
  if (price > config.maxPrice) return [];
  const image = htmlText(one(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i));
  return [{
    id: `shop-${source.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, source, title, price,
    shipping: null, totalPrice: price, location: "Deutschland", date: "", condition: "Neu",
    description: "Neuware vom Händler – Verfügbarkeit und Endpreis im Shop prüfen.", url, image
  }];
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
    <a class="photo ${o.image ? "has-image" : "no-image"}" href="${esc(o.url)}" target="_blank" rel="noopener">${o.image ? `<img src="${esc(o.image)}" alt="" loading="lazy">` : `<span>S1 II</span>`}</a>
    <div class="content"><div class="meta"><b>${esc(o.source)}${o.condition ? ` · ${esc(o.condition)}` : ""}</b><span>${esc(o.location)}</span></div>
    <h2><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title)}</a></h2>
    <div class="price">${o.price.toLocaleString("de-DE")} € ${o.shipping == null ? "" : `<small>${o.shipping ? `+ ${o.shipping.toLocaleString("de-DE")} € Versand` : "Versand kostenlos"}</small>`}</div>
    <p>${esc(o.description)}</p><div class="actions"><time>${esc(o.date)}</time><a class="offer-link" href="${esc(o.url)}" target="_blank" rel="noopener">Angebot öffnen <span aria-hidden="true">→</span></a></div></div></article>`).join("\n");
  const errors = payload.errors.length ? `<details class="source-status"><summary>${payload.errors.length} Quellen waren bei dieser Aktualisierung nicht erreichbar</summary><p>Einige Marktplätze blockieren automatische Serverabfragen zeitweise. Die übrigen Ergebnisse sind davon nicht betroffen.</p><ul>${payload.errors.map(error => `<li>${esc(error.replace(/HTTP 403/i, "Zugriff blockiert").replace(/HTTP 503/i, "vorübergehend nicht erreichbar").replace(/fetch failed/i, "Verbindung fehlgeschlagen"))}</li>`).join("")}</ul></details>` : "";
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="1800"><title>Lumix S1 II Finder</title><style>
  :root{font-family:Inter,ui-sans-serif,system-ui;color:#17211d;background:#f3f5f1}*{box-sizing:border-box}body{margin:0}header{background:#17211d;color:#fff;padding:42px max(20px,calc((100% - 1000px)/2)) 32px}h1{font-size:clamp(30px,6vw,52px);margin:0 0 7px}header p{color:#bed0c6;margin:0}.wrap{max-width:1000px;margin:auto;padding:24px 20px}.summary{display:flex;justify-content:space-between;gap:12px;margin-bottom:18px;color:#607068}.summary b{color:#17211d}.source-status{font-size:13px;color:#718078;margin:-4px 0 18px}.source-status summary{cursor:pointer;width:max-content;max-width:100%}.source-status p{margin:8px 0 4px}.source-status ul{margin:4px 0 0;padding-left:20px}.grid{display:grid;gap:15px}.card{display:grid;grid-template-columns:190px 1fr;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px #17211d12}.photo{background:#e5e9e5;min-height:155px;display:grid;place-items:center;font-size:28px;font-weight:800;color:#718078}.photo img{display:block;width:100%;height:100%;object-fit:cover}.content{padding:18px;background:#fff;color:#17211d}.meta{display:flex;justify-content:space-between;gap:12px;color:#718078;font-size:13px}.meta b{color:#2d7452}h2{font-size:19px;line-height:1.3;margin:8px 0}a{color:inherit;text-decoration:none}h2 a:hover{text-decoration:underline}.price{font-size:25px;font-weight:800}.price small{font-size:13px;font-weight:400;color:#718078}.content p{color:#53615a;margin:8px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px}.content time{color:#718078;font-size:13px}.offer-link{display:inline-flex;align-items:center;gap:7px;color:#236744;background:#e7f2eb;border-radius:999px;padding:8px 12px;font-size:13px;font-weight:700}.offer-link:hover{background:#d9ebdf}.empty{background:#fff;padding:38px;border-radius:16px;text-align:center}@media(max-width:650px){header{padding:30px 20px 25px}header h1{font-size:34px;line-height:1.08}.wrap{padding:18px 14px 32px}.summary{display:grid;gap:4px;margin-bottom:16px;font-size:14px}.source-status{margin:0 2px 16px;line-height:1.4}.grid{gap:20px}.card{display:flex;flex-direction:column;background:transparent;border-radius:19px;overflow:visible;box-shadow:none}.photo{order:1;position:relative;z-index:1;width:100%;border-radius:19px 19px 0 0;overflow:hidden}.photo.has-image{display:block;min-height:0;aspect-ratio:auto;background:#e5e9e5}.photo.has-image img{display:block;width:100%;height:auto;max-height:none;object-fit:contain}.photo.no-image{min-height:220px;aspect-ratio:16/10}.content{order:2;position:relative;z-index:2;isolation:isolate;width:100%;margin:0;padding:19px;background:#fff;color:#17211d;border:1px solid #e1e7e3;border-top:0;border-radius:0 0 19px 19px;box-shadow:0 8px 24px #17211d18}.meta{align-items:flex-start;flex-wrap:wrap}.meta span{text-align:right}h2{font-size:21px;line-height:1.28;margin:11px 0}.price{font-size:29px;line-height:1.2}.price small{display:block;margin-top:5px}.content p{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-height:1.45;margin:12px 0;color:#53615a}.actions{margin-top:15px;padding-top:14px;border-top:1px solid #e8ece9}.offer-link{padding:10px 14px;font-size:14px}}@media(max-width:380px){.meta{display:block}.meta span{display:block;text-align:left;margin-top:4px}.actions{align-items:stretch;flex-direction:column}.offer-link{justify-content:center;width:100%}}
  </style></head><body><header><h1>Lumix S1 II Finder</h1><p>Nur das exakte Modell · neu &amp; gebraucht · Deutschland</p></header><main class="wrap"><div class="summary"><b>${payload.offers.length} passende Angebote</b><span>Aktualisiert: ${new Date(payload.updatedAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} Uhr · bis ${config.maxPrice.toLocaleString("de-DE")} €</span></div>${errors}<div class="grid">${cards || '<div class="empty">Aktuell keine passenden Angebote unter deiner Preisgrenze.</div>'}</div></main></body></html>`;
}

export async function generate({ fixtureDirectory } = {}) {
  const config = JSON.parse(await readFile(path.join(root, "config.json"), "utf8"));
  const sources = [
    { key: "kleinanzeigen", name: "Kleinanzeigen", url: "https://www.kleinanzeigen.de/s-foto/panasonic-lumix-s1-ii/k0c245", fixture: "kleinanzeigen.html", parser: parseKleinanzeigen },
    { key: "kleinanzeigen", name: "Kleinanzeigen", url: "https://www.kleinanzeigen.de/s-foto/panasonic-lumix-s1/k0c245", fixture: "kleinanzeigen-breit.html", parser: parseKleinanzeigen },
    { key: "kleinanzeigen", name: "Kleinanzeigen", url: "https://www.kleinanzeigen.de/s-multimedia-elektronik/lumix-s1/k0c161", fixture: "kleinanzeigen-breit.html", parser: parseKleinanzeigen },
    { key: "ebay", name: "eBay", url: "https://www.ebay.de/sch/i.html?_nkw=panasonic+lumix+s1+ii&_sacat=31388&LH_PrefLoc=1&LH_ItemCondition=3000&_sop=15", fixture: "ebay.html", parser: parseEbay },
    { key: "calumet", name: "Calumet", url: "https://www.calumet.de/product/panasonic-lumix-s1ii", fixture: "shop.html", product: true },
    { key: "fotokoch", name: "Foto Koch", url: "https://www.fotokoch.de/Panasonic-Lumix-DC-S1II-Gehaeuse-L-Mount_37884.html", fixture: "shop.html", product: true },
    { key: "fotoerhardt", name: "Foto Erhardt", url: "https://www.foto-erhardt.de/kameras/systemkameras/panasonic-pro-s/panasonic-lumix-dc-s1ii-plus-sigma-28-70mm-f2-8-dg-dn-c-l-mount.html", fixture: "shop.html", product: true },
    { key: "kamerafotohaus", name: "Kamera Fotohaus", url: "https://www.kamera-fotohaus.de/produkte/kameras/systemkameras/panasonic-2/lumix-s-serie/lumix-dc-s1-ii-gehause-50448", fixture: "shop.html", product: true },
    { key: "dsv24", name: "DSV24", url: "https://www.dsv24.de/Panasonic-Lumix-DC-S1II-Gehaeuse-L-Mount_37884.html", fixture: "shop.html", product: true },
    { key: "geizhals", name: "Geizhals", url: "https://geizhals.de/panasonic-lumix-dc-s1ii-v198862.html", fixture: "shop.html", product: true },
    { key: "idealo", name: "Idealo", url: "https://www.idealo.de/preisvergleich/OffersOfProduct/206513069_-lumix-dc-s1ii-panasonic.html", fixture: "shop.html", product: true }
  ].filter(source => config.sources[source.key]);
  const errors = [], offers = [];
  for (const source of sources) {
    try {
      const file = fixtureDirectory && path.join(fixtureDirectory, source.fixture);
      if (file && source.fixture === "kleinanzeigen-breit.html") continue;
      const html = file ? await readFile(file, "utf8") : await fetchPage(source.url);
      offers.push(...(source.product ? parseProductPage(html, config, source.name, source.url) : source.parser(html, config)));
    } catch (error) { errors.push(`${source.name}: ${error.message}`); }
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
