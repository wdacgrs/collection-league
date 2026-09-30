import { NextResponse } from "next/server";
import { and, eq, or, sql } from "drizzle-orm";
import { cleanName, error } from "@/lib/api";
import { canonicalNameExpr } from "@/lib/catalog";
import { validateCommanderChange } from "@/lib/commander-selection";
import { MAX_COMMANDERS, parseCommanderNames, serializeCommanderNames } from "@/lib/deck-identity";
import { getDb } from "@/lib/db";
import { catalog, collectionCards, deckCards, decks } from "@/db/schema";

type Context = { params: Promise<{ id: string; deckId: string }> };

export async function GET(_: Request, { params }: Context) {
  const { id, deckId } = await params;
  const db = getDb();

  // One round trip. The cards query is scoped through the deck's owner so a
  // mismatched profile id can never leak another profile's deck cards.
  const [deckRows, cards] = await db.batch([
    db
      .select()
      .from(decks)
      .where(and(eq(decks.id, deckId), eq(decks.profileId, id)))
      .limit(1),
    db
      .select({
        id: deckCards.id,
        deckId: deckCards.deckId,
        name: deckCards.name,
        qty: deckCards.qty,
        isBasic: deckCards.isBasic,
      })
      .from(deckCards)
      .innerJoin(
        decks,
        and(eq(decks.id, deckCards.deckId), eq(decks.profileId, id)),
      )
      .where(eq(deckCards.deckId, deckId))
      .orderBy(deckCards.name),
  ]);
  const deck = deckRows[0];
  if (!deck) return error("Deck not found.", 404);
  return NextResponse.json({ deck, cards });
}

export async function PUT(request: Request, { params }: Context) {
  const { id, deckId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const changesCommander = body.commander !== undefined || body.commanders !== undefined;
  if (body.name === undefined && !changesCommander)
    return error("Provide a name or commander to update.");

  const updateData: { name?: string; commander?: string | null } = {};
  if (body.name !== undefined) {
    updateData.name = cleanName(body.name);
    if (!updateData.name) return error("Deck name is required.");
  }

  const db = getDb();
  if (changesCommander) {
    // Preferred: `commanders: string[]`. Also accepted: the stored encoding
    // `commander: "A // B" | null`, which the deck editor sends.
    let requested: string[];
    if (body.commanders !== undefined && body.commanders !== null) {
      if (!Array.isArray(body.commanders) || body.commanders.some((n) => typeof n !== "string"))
        return error("Commanders must be a list of card names.");
      requested = (body.commanders as string[]).map(cleanName).filter(Boolean);
    } else {
      if (body.commander !== undefined && body.commander !== null && typeof body.commander !== "string")
        return error("Commander must be a card name or null.");
      requested = parseCommanderNames(cleanName(body.commander));
    }
    if (requested.length > MAX_COMMANDERS) return error(`Choose at most ${MAX_COMMANDERS} commanders.`);

    // One round trip: the deck's current commanders (kept as-is), plus the
    // catalog types and owned copies of the requested names (≤2, few params).
    const [deckRows, catalogRows, ownedRows] = await db.batch([
      db.select({ commander: decks.commander }).from(decks)
        .where(and(eq(decks.id, deckId), eq(decks.profileId, id))).limit(1),
      db.select({ name: catalog.name, type: catalog.type }).from(catalog)
        .where(requested.length ? or(...requested.map((n) => sql`${catalog.name} = ${n} COLLATE NOCASE`)) : sql`0`),
      db.select({ name: collectionCards.name, qty: collectionCards.qty, owned: collectionCards.owned })
        .from(collectionCards)
        .where(requested.length
          ? and(eq(collectionCards.profileId, id), or(...requested.map((n) => eq(collectionCards.name, canonicalNameExpr(n)))))
          : sql`0`),
    ]);
    if (!deckRows.length) return error("Deck not found.", 404);
    const check = validateCommanderChange(
      requested, parseCommanderNames(deckRows[0].commander), catalogRows, ownedRows,
    );
    if (!check.ok) return error(check.error);
    updateData.commander = serializeCommanderNames(check.names);
  }

  // UPDATE ... RETURNING: existence check, write, and re-read in one statement.
  const updated = await db
    .update(decks)
    .set(updateData)
    .where(and(eq(decks.id, deckId), eq(decks.profileId, id)))
    .returning();
  if (!updated.length) return error("Deck not found.", 404);
  return NextResponse.json({ deck: updated[0] });
}

export async function DELETE(_: Request, { params }: Context) {
  const { id, deckId } = await params;
  const deleted = await getDb()
    .delete(decks)
    .where(and(eq(decks.id, deckId), eq(decks.profileId, id)))
    .returning({ id: decks.id });
  if (!deleted.length) return error("Deck not found.", 404);
  return NextResponse.json({ deleted: true });
}
