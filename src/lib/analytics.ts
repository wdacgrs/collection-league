import type { CatalogCard } from "./catalog-data";

export type AnalyticsProfile = { id: string; name: string; iconCard: string | null };
export type OwnedEntry = { profileId: string; name: string; qty: number };

const RARITIES = ["common", "uncommon", "rare", "mythic"] as const;
type Rarity = (typeof RARITIES)[number];

/**
 * Aggregate league analytics in O(catalog + profiles + entries).
 * Card names match case-insensitively; per (profile, card) only the first
 * matching entry counts, so case-variant duplicates are not double-counted.
 */
export function buildAnalytics(
  catalog: readonly CatalogCard[],
  profiles: readonly AnalyticsProfile[],
  entries: readonly OwnedEntry[],
) {
  const catalogByName = new Map(
    catalog.map((card) => [card.name.toLocaleLowerCase(), card]),
  );

  // Per-card totals and per-profile stats, both filled in one pass.
  const cardTotals = new Map<string, { owners: number; totalQty: number }>();
  const profileStats = new Map<
    string,
    { ownedCards: number; ownedQty: number; byRarity: Record<Rarity, number> }
  >();
  const seen = new Set<string>();

  for (const entry of entries) {
    const key = entry.name.toLocaleLowerCase();
    const card = catalogByName.get(key);
    if (!card) continue;

    const stats = profileStats.get(entry.profileId) ?? {
      ownedCards: 0,
      ownedQty: 0,
      byRarity: { common: 0, uncommon: 0, rare: 0, mythic: 0 },
    };
    stats.ownedCards += 1;
    stats.ownedQty += entry.qty;
    const rarity = card.rarity.toLocaleLowerCase();
    if ((RARITIES as readonly string[]).includes(rarity)) {
      stats.byRarity[rarity as Rarity] += 1;
    }
    profileStats.set(entry.profileId, stats);

    const seenKey = `${entry.profileId}\u0000${key}`;
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);
    const totals = cardTotals.get(key) ?? { owners: 0, totalQty: 0 };
    totals.owners += 1;
    totals.totalQty += entry.qty;
    cardTotals.set(key, totals);
  }

  const players = profiles.map((profile) => {
    const stats = profileStats.get(profile.id) ?? {
      ownedCards: 0,
      ownedQty: 0,
      byRarity: { common: 0, uncommon: 0, rare: 0, mythic: 0 },
    };
    return {
      id: profile.id,
      name: profile.name,
      iconCard: profile.iconCard,
      ...stats,
      completionPct: Number(((stats.ownedCards / catalog.length) * 100).toFixed(1)),
    };
  });

  const cards = catalog.map((card) => {
    const totals = cardTotals.get(card.name.toLocaleLowerCase()) ?? { owners: 0, totalQty: 0 };
    return {
      name: card.name,
      rarity: card.rarity,
      colors: card.colors,
      img: card.img,
      ...totals,
    };
  });

  return { players, cards };
}
