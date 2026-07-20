import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isExactModel, parsePrice, parseKleinanzeigen, parseEbay, parseProductPage, renderPage } from "./generate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = name => readFile(path.join(root, "tests", "fixtures", name), "utf8");
const config = { maxPrice: 3000, includeNew: false };

test("erkennt ausschließlich die S1 II", () => {
  for (const title of ["Panasonic Lumix S1 II Body", "Lumix S1II Kamera", "Panasonic S1MK2 Gehäuse", "Panasonic S1 2 Vollformat", "Lumix S1ii wie NEU 2 Monate alt mit Zubehör"]) assert.equal(isExactModel(title, true), true, title);
  for (const title of ["Lumix S1R II", "Panasonic S5 II", "Lumix S1 IIE", "Cage für Lumix S1 II", "Suche Panasonic S1 II"]) assert.equal(isExactModel(title), false, title);
});

test("liest deutsche Preise", () => {
  assert.equal(parsePrice("2.399 € VB"), 2399);
  assert.equal(parsePrice("EUR 2.499,00"), 2499);
});

test("liest Marktplatz-Karten und verwirft falsche Modelle", async () => {
  const kleinanzeigen = parseKleinanzeigen(await fixture("kleinanzeigen.html"), config);
  const ebay = parseEbay(await fixture("ebay.html"), config);
  assert.equal(kleinanzeigen.length, 1);
  assert.equal(ebay.length, 1);
  assert.equal(kleinanzeigen[0].price, 2399);
  assert.equal(ebay[0].price, 2499);
});

test("liest Neuware von Händler-Produktseiten", async () => {
  const offers = parseProductPage(await fixture("shop.html"), config, "Fotohändler", "https://shop.example/s1ii");
  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 2999);
  assert.equal(offers[0].condition, "Neu");
});

test("zeigt Quellenfehler verständlich und eingeklappt", () => {
  const html = renderPage({ updatedAt: new Date().toISOString(), offers: [], errors: ["eBay: HTTP 403", "Idealo: HTTP 503"] }, config);
  assert.match(html, /<details class="source-status">/);
  assert.match(html, /eBay: Zugriff blockiert/);
  assert.match(html, /Idealo: vorübergehend nicht erreichbar/);
  assert.doesNotMatch(html, /<aside>/);
});

test("rendert entspannte einspaltige Angebotskarten auf Mobilgeräten", () => {
  const payload = { updatedAt: new Date().toISOString(), errors: [], offers: [{
    id: "mobile-1", source: "Kleinanzeigen", condition: "Gebraucht", title: "Lumix S1 II wie neu",
    price: 2700, shipping: null, location: "Berlin", description: "Mit OVP", date: "Heute",
    url: "https://example.com/angebot", image: "https://example.com/kamera.jpg"
  }] };
  const html = renderPage(payload, config);
  assert.match(html, /@media\(max-width:650px\).*?\.card\{grid-template-columns:1fr/s);
  assert.match(html, /class="offer-link"[^>]*>Angebot öffnen/);
  assert.match(html, /neu &amp; gebraucht/);
});
