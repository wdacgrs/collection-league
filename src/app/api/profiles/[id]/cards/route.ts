import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { cleanName, error } from "@/lib/api";
import { catalogNameQuery } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { collectionCards, profiles } from "@/db/schema";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const rawName = cleanName(body.name);
  const qtyInput = body.qty;
  if (!rawName) return error("Card name is required.");
  if (
    qtyInput !== undefined &&
    (typeof qtyInput !== "number" ||
      !Number.isInteger(qtyInput) ||
      qtyInput < 0)
  )
    return error("Quantity must be a non-negative integer.");
  if (body.owned !== undefined && typeof body.owned !== "boolean")
    return error("Owned must be true or false.");

  const db = getDb();

  // Round trip 1: profile existence + canonical name lookup, batched.
  const [profileRows, nameRows] = await db.batch([
    db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, id))
      .limit(1),
    catalogNameQuery(db, rawName),
  ]);
  if (!profileRows.length) return error("Profile not found.", 404);
  const name = nameRows[0]?.name ?? rawName;

  // Round trip 2: delete or upsert.
  if (qtyInput === 0) {
    await db
      .delete(collectionCards)
      .where(
        and(eq(collectionCards.profileId, id), eq(collectionCards.name, name)),
      );
    return NextResponse.json({ deleted: true });
  }

  const qty = typeof qtyInput === "number" ? qtyInput : 1;
  const owned = typeof body.owned === "boolean" ? body.owned : true;
  // On conflict only overwrite the fields the caller provided; `qty = qty` is
  // a no-op that keeps the SET clause non-empty so RETURNING still yields the row.
  const set = {
    qty:
      qtyInput !== undefined
        ? sql`excluded."qty"`
        : sql`${collectionCards.qty}`,
    ...(body.owned !== undefined ? { owned: sql`excluded."owned"` } : {}),
  };
  const [card] = await db
    .insert(collectionCards)
    .values({ id: crypto.randomUUID(), profileId: id, name, qty, owned })
    .onConflictDoUpdate({
      target: [collectionCards.profileId, collectionCards.name],
      set,
    })
    .returning();
  return NextResponse.json({ card });
}
