import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildAnalytics, type AnalyticsProfile, type OwnedEntry } from "./analytics";
import type { CatalogCard } from "./catalog-data";

// The original O(catalog × profiles × entries) implementation, kept as oracle.
function naive(catalog: CatalogCard[], profiles: AnalyticsProfile[], entries: OwnedEntry[]) {
  const catalogByName = new Map(catalog.map((c) => [c.name.toLocaleLowerCase(), c]));
  const byProfile = new Map<string, OwnedEntry[]>();
  for (const e of entries) byProfile.set(e.profileId, [...(byProfile.get(e.profileId) ?? []), e]);
  const players = profiles.map((p) => {
    const byRarity = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
    let ownedCards = 0;
    let ownedQty = 0;
    for (const e of byProfile.get(p.id) ?? []) {
      const card = catalogByName.get(e.name.toLocaleLowerCase());
      if (!card) continue;
      ownedCards += 1;
      ownedQty += e.qty;
      const r = card.rarity.toLocaleLowerCase() as keyof typeof byRarity;
      if (r in byRarity) byRarity[r] += 1;
    }
    return {
      id: p.id, name: p.name, iconCard: p.iconCard, ownedCards, ownedQty, byRarity,
      completionPct: Number(((ownedCards / catalog.length) * 100).toFixed(1)),
    };
  });
  const cards = catalog.map((card) => {
    let owners = 0;
    let totalQty = 0;
    for (const [, list] of byProfile) {
      const e = list.find((i) => i.name.toLocaleLowerCase() === card.name.toLocaleLowerCase());
      if (!e) continue;
      owners += 1;
      totalQty += e.qty;
    }
    return { name: card.name, rarity: card.rarity, colors: card.colors, img: card.img, owners, totalQty };
  });
  return { players, cards };
}

const NAMES = ["Sol Ring", "sol ring", "Island", "Counterspell", "Llanowar Elves", "Unknown"];
const RARITY = ["common", "uncommon", "rare", "mythic", "Rare", "special"];

const catalogArb = fc
  .uniqueArray(fc.constantFrom(...NAMES.slice(0, 5)), {
    selector: (n) => n.toLocaleLowerCase(),
    minLength: 1,
  })
  .chain((names) =>
    fc.tuple(...names.map((name) =>
      fc.constantFrom(...RARITY).map((rarity): CatalogCard => ({
        name, rarity, qty: 1, img: "", colors: "", type: "", colorIdentity: "",
      })),
    )),
  );
const profilesArb = fc.uniqueArray(
  fc.constantFrom("p1", "p2", "p3").map((id): AnalyticsProfile => ({ id, name: id, iconCard: null })),
  { selector: (p) => p.id },
);
const entriesArb = fc.array(
  fc.record({
    profileId: fc.constantFrom("p1", "p2", "p3", "ghost"),
    name: fc.constantFrom(...NAMES),
    qty: fc.integer({ min: 1, max: 9 }),
  }),
  { maxLength: 30 },
);

describe("buildAnalytics", () => {
  it("matches the original nested-loop implementation", () => {
    fc.assert(
      fc.property(catalogArb, profilesArb, entriesArb, (catalog, profiles, entries) => {
        expect(buildAnalytics(catalog, profiles, entries)).toEqual(naive(catalog, profiles, entries));
      }),
      { numRuns: 300 },
    );
  });
});
