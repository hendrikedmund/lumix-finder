import test from "node:test";
import assert from "node:assert/strict";
import { findNewOffers, mergeSeenIds } from "./notify.mjs";

test("meldet nur bisher unbekannte Angebots-IDs", () => {
  const previous = { offers: [{ id: "alt-1" }], seenIds: ["alt-1", "verschwunden-2"] };
  const current = { offers: [{ id: "alt-1" }, { id: "neu-3" }] };
  assert.deepEqual(findNewOffers(current, previous).map(offer => offer.id), ["neu-3"]);
});

test("behält auch verschwundene Angebote als bereits gesehen", () => {
  const previous = { seenIds: ["alt-1", "verschwunden-2"] };
  const current = { offers: [{ id: "neu-3" }] };
  assert.deepEqual(mergeSeenIds(current, previous), ["alt-1", "verschwunden-2", "neu-3"]);
});
