import { NextResponse } from "next/server";
import { isConstraintError, qualified } from "@/lib/sql";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { cleanName, error } from "@/lib/api";
import { canonicalNameExpr } from "@/lib/catalog";
import { validateCommanderSelection } from "@/lib/commander-selection";
import { serializeCommanderNames, MAX_COMMANDERS } from "@/lib/deck-identity";
import { getDb } from "@/lib/db";
import {
  catalog,
  collectionCards,
  deckCards,
  decks,
  profiles,
} from "@/db/schema";

type Context = { params: Promise<{ id: string }> };

/** Deck summaries only — for pickers that don't need the whole collection. */
export async function GET(_: Request, { params }: Context) {
  const { id } = await params;
  const db = getDb();
  const [profileRows, profileDecks] = await db.batch([
    db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, id)).limit(1),
    db.select({
      id: decks.id, name: decks.name, commander: decks.commander,
      cardCount: sql<number>`coalesce((select sum(${qualified(deckCards.qty)}) from ${deckCards} where ${qualified(deckCards.deckId)} = ${qualified(decks.id)}), 0)`,
    }).from(decks).where(eq(decks.profileId, id)).orderBy(desc(decks.createdAt)),
  ]);
  if (!profileRows.length) return error("Profile not found.", 404);
  return NextResponse.json({ decks: profileDecks });
}

/**
 * Read requested commanders from the body. Preferred: `commanders: string[]`
 * (0–2 names). Legacy: `commander: string | null` (a single name).
 */
function requestedCommanders(body: Record<string, unknown>): string[] | { error: string } {
  if (body.commanders !== undefined && body.commanders !== null) {
    if (!Array.isArray(body.commanders) || body.commanders.some((n) => typeof n !== "string")) {
      return { error: "Commanders must be a list of card names." };
    }
    if (body.commanders.length > MAX_COMMANDERS) {
      return { error: `Choose at most ${MAX_COMMANDERS} commanders.` };
    }
    return (body.commanders as string[]).map(cleanName).filter(Boolean);
  }
  if (body.commander !== undefined && body.commander !== null && typeof body.commander !== "string") {
    return { error: "Commander must be a card name or null." };
  }
  const single = cleanName(body.commander);
  return single ? [single] : [];
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const name = cleanName(body.name);
  if (!name) return error("Deck name is required.");
  const requested = requestedCommanders(body);
  if (!Array.isArray(requested)) return error(requested.error);

  const db = getDb();
  let commander: string | null = null;

  if (requested.length) {
    // One round trip: profile existence, the requested catalog cards (for the
    // legendary-creature check) and the player's copies of them. At most 2
    // names, so every statement binds only a handful of params.
    const [profileRows, catalogRows, ownedRows] = await db.batch([
      db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, id))
        .limit(1),
      db
        .select({ name: catalog.name, type: catalog.type })
        .from(catalog)
        .where(
          or(
            ...requested.map((n) => sql`${catalog.name} = ${n} COLLATE NOCASE`),
          ),
        ),
      db
        .select({
          name: collectionCards.name,
          qty: collectionCards.qty,
          owned: collectionCards.owned,
        })
        .from(collectionCards)
        .where(
          and(
            eq(collectionCards.profileId, id),
            or(
              ...requested.map((n) =>
                eq(collectionCards.name, canonicalNameExpr(n)),
              ),
            ),
          ),
        ),
    ]);
    if (!profileRows.length) return error("Profile not found.", 404);
    const check = validateCommanderSelection(requested, catalogRows, ownedRows);
    if (!check.ok) return error(check.error);
    commander = serializeCommanderNames(check.names);
  }

  // The Deck.profileId foreign key rejects unknown profiles (covers the
  // no-commander path), and RETURNING replaces the re-select.
  try {
    const [deck] = await db
      .insert(decks)
      .values({
        id: crypto.randomUUID(),
        profileId: id,
        name,
        commander,
        createdAt: new Date().toISOString(),
      })
      .returning();
    return NextResponse.json({ deck }, { status: 201 });
  } catch (cause) {
    if (isConstraintError(cause, "FOREIGN KEY")) {
      return error("Profile not found.", 404);
    }
    throw cause;
  }
}
