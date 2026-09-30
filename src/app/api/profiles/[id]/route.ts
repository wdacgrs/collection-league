import { NextResponse } from "next/server";
import { isConstraintError, qualified } from "@/lib/sql";
import { desc, eq, sql } from "drizzle-orm";
import { cleanName, error } from "@/lib/api";
import { resolveCatalogName } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { collectionCards, deckCards, decks, profiles } from "@/db/schema";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Context) {
  const { id } = await params;
  const db = getDb();
  // One round trip: profile, collection, and decks with per-deck card totals
  // (correlated subquery served by DeckCard_deckId_name_key).
  const [profileRows, cards, profileDecks] = await db.batch([
    db.select().from(profiles).where(eq(profiles.id, id)).limit(1),
    db
      .select()
      .from(collectionCards)
      .where(eq(collectionCards.profileId, id))
      .orderBy(collectionCards.name),
    db
      .select({
        id: decks.id,
        profileId: decks.profileId,
        name: decks.name,
        commander: decks.commander,
        createdAt: decks.createdAt,
        cardCount: sql<number>`coalesce((select sum(${qualified(deckCards.qty)}) from ${deckCards} where ${qualified(deckCards.deckId)} = ${qualified(decks.id)}), 0)`,
      })
      .from(decks)
      .where(eq(decks.profileId, id))
      .orderBy(desc(decks.createdAt)),
  ]);
  const profile = profileRows[0];
  if (!profile) return error("Profile not found.", 404);
  return NextResponse.json({ profile, cards, decks: profileDecks });
}

export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const data: { name?: string; iconCard?: string | null } = {};
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = cleanName(body.name);
    if (!name) return error("Profile name is required.");
    data.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(body, "iconCard")) {
    if (body.iconCard === null) data.iconCard = null;
    else if (typeof body.iconCard !== "string")
      return error("iconCard must be a card name or null.");
  }
  if (!Object.keys(data).length && typeof body.iconCard !== "string")
    return error("No profile changes provided.");

  const db = getDb();
  if (typeof body.iconCard === "string") {
    // Single indexed row lookup instead of loading the whole catalog.
    const canonicalName = await resolveCatalogName(body.iconCard, db);
    if (!canonicalName) return error("Unknown card name.");
    data.iconCard = canonicalName;
  }

  // UPDATE ... RETURNING doubles as the existence check; the UNIQUE index on
  // name replaces a separate duplicate-name lookup.
  let updated;
  try {
    updated = await db
      .update(profiles)
      .set(data)
      .where(eq(profiles.id, id))
      .returning();
  } catch (cause) {
    if (isConstraintError(cause, "UNIQUE")) {
      return error("A profile with that name already exists.", 409);
    }
    throw cause;
  }
  if (!updated.length) return error("Profile not found.", 404);
  return NextResponse.json({ profile: updated[0] });
}

export async function DELETE(_: Request, { params }: Context) {
  const { id } = await params;
  const db = getDb();
  const deleted = await db
    .delete(profiles)
    .where(eq(profiles.id, id))
    .returning({ id: profiles.id });
  if (!deleted.length) return error("Profile not found.", 404);
  return NextResponse.json({ deleted: true });
}
