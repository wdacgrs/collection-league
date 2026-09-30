// Pure grouping for the deck editor's collection pool. No React, no D1.

/** Pool group order: WUBRG, then colorless, then multicolor. Basic lands come last, separately. */
export const COLOR_GROUPS = ["White", "Blue", "Black", "Red", "Green", "Colorless", "Multicolor"] as const;
export type ColorGroup = (typeof COLOR_GROUPS)[number];
export const BASIC_LANDS_GROUP = "Basic lands";

const RARITY_ORDER: Record<string, number> = { mythic: 0, rare: 1, uncommon: 2, common: 3 };

type PoolCatalogCard = { colors: string; rarity: string };

/** Map a catalog `colors` value ("white", "multi", "colorless", …) to its pool group. */
export function colorGroup(colors: string | null | undefined): ColorGroup {
  const value = (colors || "colorless").trim().toLowerCase();
  if (value.includes(",") || value.includes("multi") || value.split(/\s+/).length > 1) return "Multicolor";
  const single: Record<string, ColorGroup> = {
    white: "White", blue: "Blue", black: "Black", red: "Red", green: "Green", colorless: "Colorless",
  };
  return single[value] ?? "Colorless";
}

export type PoolEntry<T> = { card: T; offColor: boolean };
export type PoolGroup<T> = { group: ColorGroup; entries: PoolEntry<T>[] };

/**
 * Group owned non-basic cards by color for the pool.
 * - `isLegal(name)` false marks a card off-color (outside the commander identity).
 *   Off-color cards are left out unless `showOffColor` is true, and are counted in `hiddenCount`.
 * - Only cards matching `search` (case-insensitive substring) are considered.
 * - Groups follow COLOR_GROUPS order, only non-empty ones are returned, and each
 *   group is sorted by rarity (mythic first) then name.
 */
export function buildPoolGroups<T extends { name: string }>(
  owned: readonly T[],
  options: {
    catalogByName: ReadonlyMap<string, PoolCatalogCard>;
    isBasic: (name: string) => boolean;
    isLegal: (name: string) => boolean;
    search: string;
    showOffColor: boolean;
  },
): { groups: PoolGroup<T>[]; hiddenCount: number } {
  const query = options.search.trim().toLowerCase();
  const byGroup = new Map<ColorGroup, PoolEntry<T>[]>(COLOR_GROUPS.map((g) => [g, []]));
  let hiddenCount = 0;
  for (const card of owned) {
    if (options.isBasic(card.name)) continue;
    if (query && !card.name.toLowerCase().includes(query)) continue;
    const offColor = !options.isLegal(card.name);
    if (offColor && !options.showOffColor) {
      hiddenCount += 1;
      continue;
    }
    const info = options.catalogByName.get(card.name.toLowerCase());
    byGroup.get(colorGroup(info?.colors))!.push({ card, offColor });
  }
  const rarity = (name: string) =>
    RARITY_ORDER[options.catalogByName.get(name.toLowerCase())?.rarity.toLowerCase() ?? ""] ?? 9;
  const groups: PoolGroup<T>[] = [];
  for (const group of COLOR_GROUPS) {
    const entries = byGroup.get(group)!;
    if (!entries.length) continue;
    entries.sort((a, b) => rarity(a.card.name) - rarity(b.card.name) || a.card.name.localeCompare(b.card.name));
    groups.push({ group, entries });
  }
  return { groups, hiddenCount };
}
