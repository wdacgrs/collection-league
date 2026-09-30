import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { cleanName, error } from "@/lib/api";
import { canonicalNameExpr, catalogNameQuery } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { collectionCards, deckCards, decks } from "@/db/schema";

type Context = { params: Promise<{ id: string; deckId: string }> };
const BASICS = new Set(["plains", "island", "swamp", "mountain", "forest"]);

export async function PUT(request: Request, { params }: Context) {
  const { id, deckId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const rawName = cleanName(body.name);
  const qty = body.qty;
  if (!rawName) return error("Card name is required.");
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0)
    return error("Quantity must be a non-negative integer.");

  const db = getDb();

  // Round trip 1: deck ownership, canonical name, and owned collection qty
  // (matched by canonical name in SQL) all in one batch.
  const [deckRows, nameRows, collectionRows] = await db.batch([
    db
      .select({ id: decks.id })
      .from(decks)
      .where(and(eq(decks.id, deckId), eq(decks.profileId, id)))
      .limit(1),
    catalogNameQuery(db, rawName),
    db
      .select({ qty: collectionCards.qty, owned: collectionCards.owned })
      .from(collectionCards)
      .where(
        and(
          eq(collectionCards.profileId, id),
          eq(collectionCards.name, canonicalNameExpr(rawName)),
        ),
      )
      .limit(1),
  ]);
  if (!deckRows.length) return error("Deck not found.", 404);

  const name = nameRows[0]?.name ?? rawName;
  const isBasic = BASICS.has(name.toLocaleLowerCase());

  if (isBasic && qty > 99)
    return error("Basic land quantity cannot exceed 99.");

  if (!isBasic && qty > 0) {
    const collection = collectionRows[0];
    const available = collection?.owned ? collection.qty : 0;
    if (qty > available)
      return error(`Only ${available} owned ${name} available.`);
  }

  // Round trip 2: delete or upsert.
  if (qty === 0) {
    await db
      .delete(deckCards)
      .where(and(eq(deckCards.deckId, deckId), eq(deckCards.name, name)));
    return NextResponse.json({ deleted: true });
  }

  const [card] = await db
    .insert(deckCards)
    .values({ id: crypto.randomUUID(), deckId, name, qty, isBasic })
    .onConflictDoUpdate({
      target: [deckCards.deckId, deckCards.name],
      set: { qty: sql`excluded."qty"`, isBasic: sql`excluded."isBasic"` },
    })
    .returning();
  return NextResponse.json({ card });
}
