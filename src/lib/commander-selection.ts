// Pure commander-eligibility rules shared by the create-deck form and the
// deck-creation API. No React, no D1.

import { MAX_COMMANDERS } from "./deck-identity";

/** Separator used by `serializeCommanderNames`; a name containing it can't be stored. */
const COMMANDER_SEP = " // ";

export type TypedCard = { name: string; type: string };
export type OwnedEntry = { name: string; qty: number; owned: boolean };

export type CommanderCheck =
  | { ok: true; names: string[] }
  | { ok: false; error: string };

/**
 * True when a type line describes a legendary creature, e.g.
 * "Legendary Creature — Human Knight" or "Legendary Artifact Creature — Golem".
 * Only the front face (before " // ") and the part before the subtype dash
 * count, so "Creature — Wolf // Legendary …" backs and subtypes never match.
 */
export function isLegendaryCreature(type: string | null | undefined): boolean {
  if (typeof type !== "string") return false;
  const supertypes = type.split("//")[0].split("—")[0];
  return /\blegendary\b/i.test(supertypes) && /\bcreature\b/i.test(supertypes);
}

function isOwned(entry: OwnedEntry | undefined): boolean {
  return Boolean(entry && entry.owned && entry.qty > 0);
}

/**
 * Names of the legendary creatures a player owns (owned and qty > 0), using
 * canonical catalog names, de-duplicated and sorted alphabetically.
 */
export function commanderCandidates(
  collection: readonly OwnedEntry[],
  catalog: readonly TypedCard[],
): string[] {
  const byName = new Map(catalog.map((card) => [card.name.toLowerCase(), card]));
  const names = new Set<string>();
  for (const entry of collection) {
    if (!isOwned(entry)) continue;
    const card = byName.get(entry.name.toLowerCase());
    if (card && isLegendaryCreature(card.type)) names.add(card.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Validate changing a deck's commanders from `current` to `requested`.
 * Names already selected on the deck are kept as-is (so decks created before
 * these rules can still drop or keep a legacy commander); every newly added
 * name must pass `validateCommanderSelection`. Still at most 2, distinct.
 */
export function validateCommanderChange(
  requested: readonly string[],
  current: readonly string[],
  catalog: readonly TypedCard[],
  collection: readonly OwnedEntry[],
): CommanderCheck {
  const names = requested.map((n) => n.trim()).filter((n) => n.length > 0);
  if (names.length > MAX_COMMANDERS) {
    return { ok: false, error: `Choose at most ${MAX_COMMANDERS} commanders.` };
  }
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) {
    return { ok: false, error: "Choose two different commanders." };
  }
  const existing = new Map(current.map((n) => [n.trim().toLowerCase(), n.trim()]));
  const result: string[] = [];
  for (const name of names) {
    const kept = existing.get(name.toLowerCase());
    if (kept) {
      result.push(kept);
      continue;
    }
    const check = validateCommanderSelection([name], catalog, collection);
    if (!check.ok) return check;
    result.push(check.names[0]);
  }
  if (new Set(result.map((n) => n.toLowerCase())).size !== result.length) {
    return { ok: false, error: "Choose two different commanders." };
  }
  return { ok: true, names: result };
}

/**
 * Validate a requested commander selection: at most 2 distinct cards, each a
 * catalog legendary creature the player owns. Returns canonical catalog names
 * in the requested order, or the first problem found.
 */
export function validateCommanderSelection(
  requested: readonly string[],
  catalog: readonly TypedCard[],
  collection: readonly OwnedEntry[],
): CommanderCheck {
  const names = requested.map((n) => n.trim()).filter((n) => n.length > 0);
  if (names.length > MAX_COMMANDERS) {
    return { ok: false, error: `Choose at most ${MAX_COMMANDERS} commanders.` };
  }
  const byName = new Map(catalog.map((card) => [card.name.toLowerCase(), card]));
  const ownedByName = new Map(collection.map((entry) => [entry.name.toLowerCase(), entry]));
  const canonical: string[] = [];
  for (const name of names) {
    const card = byName.get(name.toLowerCase());
    if (!card) return { ok: false, error: `Unknown card: ${name}.` };
    if (!isLegendaryCreature(card.type)) {
      return { ok: false, error: `${card.name} is not a legendary creature.` };
    }
    if (card.name.includes(COMMANDER_SEP)) {
      return { ok: false, error: `${card.name} can't be used as a commander.` };
    }
    if (!isOwned(ownedByName.get(card.name.toLowerCase()))) {
      return { ok: false, error: `${card.name} is not in this player's collection.` };
    }
    if (canonical.some((n) => n.toLowerCase() === card.name.toLowerCase())) {
      return { ok: false, error: "Choose two different commanders." };
    }
    canonical.push(card.name);
  }
  return { ok: true, names: canonical };
}
