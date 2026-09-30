import { describe, expect, it } from "vitest";
import fc from "fast-check";
import catalogJson from "../../data/catalog.json";
import {
  commanderCandidates,
  isLegendaryCreature,
  validateCommanderChange,
  validateCommanderSelection,
  type OwnedEntry,
  type TypedCard,
} from "./commander-selection";

const RUNS = { numRuns: 100 };

const catalog: TypedCard[] = [
  { name: "Danitha, Sword of Hope", type: "Legendary Creature — Human Knight" },
  { name: "Karn, Argent Defender", type: "Legendary Artifact Creature — Golem" },
  { name: "Ajani Resolute", type: "Legendary Planeswalker — Ajani" },
  { name: "Gideon's Memorial", type: "Legendary Artifact" },
  { name: "Flickering Hound", type: "Creature — Dog" },
  { name: "Diviner of Victory // Unwind History", type: "Creature — Dwarf Wizard // Sorcery" },
  { name: "Island", type: "Basic Land — Island" },
];
const own = (name: string, qty = 1, owned = true): OwnedEntry => ({ name, qty, owned });

describe("isLegendaryCreature", () => {
  it.each([
    ["Legendary Creature — Human Knight", true],
    ["Legendary Artifact Creature — Golem", true],
    ["legendary creature", true],
    ["Legendary Planeswalker — Ajani", false],
    ["Legendary Artifact", false],
    ["Legendary Enchantment", false],
    ["Creature — Dog", false],
    ["Creature — Dwarf Wizard // Sorcery", false],
    // Back face or subtype text never counts.
    ["Creature — Wolf // Legendary Creature — Wolf", false],
    ["Artifact — Legendary Creature Thing", false],
    ["", false],
  ])("%s -> %s", (type, expected) => {
    expect(isLegendaryCreature(type)).toBe(expected);
  });

  it("tolerates null/undefined", () => {
    expect(isLegendaryCreature(null)).toBe(false);
    expect(isLegendaryCreature(undefined)).toBe(false);
  });

  it("finds legendary creatures in the real catalog and none among DFCs", () => {
    const cards = catalogJson as TypedCard[];
    const legendary = cards.filter((c) => isLegendaryCreature(c.type));
    expect(legendary.length).toBeGreaterThan(20);
    expect(legendary.every((c) => /legendary/i.test(c.type) && /creature/i.test(c.type))).toBe(true);
    // Stored commander strings use " // " as separator; no eligible name may contain it.
    expect(legendary.filter((c) => c.name.includes(" // "))).toEqual([]);
  });
});

describe("commanderCandidates", () => {
  it("keeps only owned (qty > 0) legendary creatures, canonical and sorted", () => {
    const result = commanderCandidates(
      [
        own("karn, argent defender"),
        own("Danitha, Sword of Hope", 2),
        own("Ajani Resolute"),
        own("Flickering Hound"),
        own("Not In Catalog"),
      ],
      catalog,
    );
    expect(result).toEqual(["Danitha, Sword of Hope", "Karn, Argent Defender"]);
  });

  it("excludes unowned and zero-qty entries", () => {
    expect(
      commanderCandidates([own("Danitha, Sword of Hope", 1, false), own("Karn, Argent Defender", 0)], catalog),
    ).toEqual([]);
  });

  it("every candidate is a legendary creature the player owns", () => {
    const names = catalog.map((c) => c.name);
    fc.assert(
      fc.property(
        fc.array(fc.record({ name: fc.constantFrom(...names), qty: fc.integer({ min: 0, max: 3 }), owned: fc.boolean() })),
        (collection) => {
          for (const name of commanderCandidates(collection, catalog)) {
            const card = catalog.find((c) => c.name === name)!;
            expect(isLegendaryCreature(card.type)).toBe(true);
            expect(collection.some((e) => e.name === name && e.owned && e.qty > 0)).toBe(true);
          }
        },
      ),
      RUNS,
    );
  });
});

describe("validateCommanderSelection", () => {
  const collection = [own("Danitha, Sword of Hope"), own("Karn, Argent Defender"), own("Ajani Resolute"), own("Flickering Hound")];

  it("accepts 0, 1 or 2 distinct owned legendary creatures and canonicalizes names", () => {
    expect(validateCommanderSelection([], catalog, collection)).toEqual({ ok: true, names: [] });
    expect(validateCommanderSelection(["  ", ""], catalog, collection)).toEqual({ ok: true, names: [] });
    expect(validateCommanderSelection(["danitha, sword of hope"], catalog, collection)).toEqual({
      ok: true,
      names: ["Danitha, Sword of Hope"],
    });
    expect(
      validateCommanderSelection(["Karn, Argent Defender", "Danitha, Sword of Hope"], catalog, collection),
    ).toEqual({ ok: true, names: ["Karn, Argent Defender", "Danitha, Sword of Hope"] });
  });

  it("rejects more than two", () => {
    const r = validateCommanderSelection(["a", "b", "c"], catalog, collection);
    expect(r).toEqual({ ok: false, error: "Choose at most 2 commanders." });
  });

  it("rejects duplicates, case-insensitively", () => {
    const r = validateCommanderSelection(["Karn, Argent Defender", "KARN, ARGENT DEFENDER"], catalog, collection);
    expect(r).toEqual({ ok: false, error: "Choose two different commanders." });
  });

  it("rejects unknown, non-legendary-creature and unowned cards", () => {
    expect(validateCommanderSelection(["Nope"], catalog, collection)).toMatchObject({ ok: false, error: "Unknown card: Nope." });
    expect(validateCommanderSelection(["Ajani Resolute"], catalog, collection)).toMatchObject({ ok: false, error: "Ajani Resolute is not a legendary creature." });
    expect(validateCommanderSelection(["Flickering Hound"], catalog, collection)).toMatchObject({ ok: false });
    expect(validateCommanderSelection(["Gideon's Memorial"], catalog, collection)).toMatchObject({ ok: false });
    expect(
      validateCommanderSelection(["Danitha, Sword of Hope"], catalog, [own("Danitha, Sword of Hope", 0)]),
    ).toMatchObject({ ok: false, error: "Danitha, Sword of Hope is not in this player's collection." });
    expect(
      validateCommanderSelection(["Danitha, Sword of Hope"], catalog, [own("Danitha, Sword of Hope", 2, false)]),
    ).toMatchObject({ ok: false });
  });

  it("accepted selections are always ≤ 2 distinct candidates", () => {
    const names = [...catalog.map((c) => c.name), "Unknown"];
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...names), { maxLength: 4 }),
        fc.array(fc.record({ name: fc.constantFrom(...names), qty: fc.integer({ min: 0, max: 2 }), owned: fc.boolean() })),
        (requested, owned) => {
          const r = validateCommanderSelection(requested, catalog, owned);
          if (!r.ok) return;
          const candidates = commanderCandidates(owned, catalog);
          expect(r.names.length).toBeLessThanOrEqual(2);
          expect(new Set(r.names.map((n) => n.toLowerCase())).size).toBe(r.names.length);
          for (const n of r.names) expect(candidates).toContain(n);
        },
      ),
      RUNS,
    );
  });
});

describe("validateCommanderChange", () => {
  const collection = [
    own("Danitha, Sword of Hope"),
    own("Karn, Argent Defender"),
    own("Flickering Hound"),
  ];

  it("keeps legacy commanders already on the deck without re-checking them", () => {
    // "Flickering Hound" is not legendary, but it was already the commander.
    expect(
      validateCommanderChange(
        ["Flickering Hound"],
        ["Flickering Hound"],
        catalog,
        collection,
      ),
    ).toEqual({
      ok: true,
      names: ["Flickering Hound"],
    });
    expect(
      validateCommanderChange(
        ["flickering hound", "Karn, Argent Defender"],
        ["Flickering Hound"],
        catalog,
        collection,
      ),
    ).toEqual({
      ok: true,
      names: ["Flickering Hound", "Karn, Argent Defender"],
    });
  });

  it("checks every newly added commander", () => {
    expect(
      validateCommanderChange(["Flickering Hound"], [], catalog, collection),
    ).toMatchObject({ ok: false });
    expect(
      validateCommanderChange(
        ["Karn, Argent Defender", "Ajani Resolute"],
        ["Karn, Argent Defender"],
        catalog,
        collection,
      ),
    ).toMatchObject({
      ok: false,
      error: "Ajani Resolute is not a legendary creature.",
    });
  });

  it("allows clearing and enforces the cap and distinctness", () => {
    expect(
      validateCommanderChange(
        [],
        ["Karn, Argent Defender"],
        catalog,
        collection,
      ),
    ).toEqual({ ok: true, names: [] });
    expect(
      validateCommanderChange(["a", "b", "c"], [], catalog, collection),
    ).toMatchObject({ ok: false, error: "Choose at most 2 commanders." });
    expect(
      validateCommanderChange(
        ["Karn, Argent Defender", "karn, argent defender"],
        [],
        catalog,
        collection,
      ),
    ).toMatchObject({
      ok: false,
      error: "Choose two different commanders.",
    });
  });
});
