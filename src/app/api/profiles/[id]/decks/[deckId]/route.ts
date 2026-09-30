import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { cleanName, error } from "@/lib/api";
import { getDb } from "@/lib/db";
import { deckCards, decks } from "@/db/schema";

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
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (body.name === undefined && body.commander === undefined)
    return error("Provide a name or commander to update.");

  const updateData: { name?: string; commander?: string | null } = {};
  if (body.name !== undefined) {
    updateData.name = cleanName(body.name);
    if (!updateData.name) return error("Deck name is required.");
  }
  if (body.commander !== undefined) {
    if (body.commander !== null && typeof body.commander !== "string")
      return error("Commander must be a card name or null.");
    updateData.commander = cleanName(body.commander) || null;
  }

  // UPDATE ... RETURNING: existence check, write, and re-read in one statement.
  const updated = await getDb()
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
