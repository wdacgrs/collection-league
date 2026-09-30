import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildPoolGroups, colorGroup, COLOR_GROUPS } from "./deck-pool";

describe("colorGroup", () => {
  it.each([
    ["white", "White"], ["Blue", "Blue"], ["black", "Black"], ["red", "Red"], ["green", "Green"],
    ["colorless", "Colorless"], ["", "Colorless"], [undefined, "Colorless"], ["multi", "Multicolor"],
    ["white, blue", "Multicolor"], ["white blue", "Multicolor"], ["purple", "Colorless"],
  ])("%s -> %s", (colors, group) => {
    expect(colorGroup(colors as string | undefined)).toBe(group);
  });

  it("orders groups WUBRG, colorless, multicolor", () => {
    expect(COLOR_GROUPS).toEqual(["White", "Blue", "Black", "Red", "Green", "Colorless", "Multicolor"]);
  });
});

const catalogByName = new Map([
  ["a", { colors: "white", rarity: "common" }],
  ["b", { colors: "white", rarity: "mythic" }],
  ["c", { colors: "multi", rarity: "rare" }],
  ["d", { colors: "colorless", rarity: "uncommon" }],
  ["e", { colors: "red", rarity: "rare" }],
  ["island", { colors: "colorless", rarity: "common" }],
]);
const owned = ["a", "b", "c", "d", "e", "Island"].map((name) => ({ name }));
const isBasic = (n: string) => n.toLowerCase() === "island";

describe("buildPoolGroups", () => {
  it("groups in color order, sorts by rarity then name, skips basics", () => {
    const { groups, hiddenCount } = buildPoolGroups(owned, { catalogByName, isBasic, isLegal: () => true, search: "", showOffColor: false });
    expect(groups.map((g) => [g.group, g.entries.map((e) => e.card.name)])).toEqual([
      ["White", ["b", "a"]],
      ["Red", ["e"]],
      ["Colorless", ["d"]],
      ["Multicolor", ["c"]],
    ]);
    expect(hiddenCount).toBe(0);
  });

  it("hides off-color cards and counts them, or shows them flagged", () => {
    const isLegal = (n: string) => n !== "e" && n !== "c";
    const hidden = buildPoolGroups(owned, { catalogByName, isBasic, isLegal, search: "", showOffColor: false });
    expect(hidden.hiddenCount).toBe(2);
    expect(hidden.groups.flatMap((g) => g.entries.map((e) => e.card.name))).toEqual(["b", "a", "d"]);

    const shown = buildPoolGroups(owned, { catalogByName, isBasic, isLegal, search: "", showOffColor: true });
    expect(shown.hiddenCount).toBe(0);
    const flags = Object.fromEntries(shown.groups.flatMap((g) => g.entries.map((e) => [e.card.name, e.offColor])));
    expect(flags).toEqual({ a: false, b: false, c: true, d: false, e: true });
  });

  it("applies the search filter before counting hidden cards", () => {
    const r = buildPoolGroups(owned, { catalogByName, isBasic, isLegal: (n) => n !== "e", search: " A ", showOffColor: false });
    expect(r.groups.flatMap((g) => g.entries.map((e) => e.card.name))).toEqual(["a"]);
    expect(r.hiddenCount).toBe(0);
  });

  it("shown + hidden always accounts for every matching non-basic card", () => {
    fc.assert(
      fc.property(fc.subarray(["a", "b", "c", "d", "e"]), fc.boolean(), (legal, show) => {
        const r = buildPoolGroups(owned, { catalogByName, isBasic, isLegal: (n) => legal.includes(n), search: "", showOffColor: show });
        const shown = r.groups.reduce((n, g) => n + g.entries.length, 0);
        expect(shown + r.hiddenCount).toBe(5);
        const order = r.groups.map((g) => COLOR_GROUPS.indexOf(g.group));
        expect([...order].sort((x, y) => x - y)).toEqual(order);
      }),
      { numRuns: 100 },
    );
  });
});
