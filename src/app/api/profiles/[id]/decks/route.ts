import { NextResponse } from "next/server";
import { isConstraintError, qualified } from "@/lib/sql";
import { desc, eq, sql } from "drizzle-orm";
import { cleanName, error } from "@/lib/api";
import { getDb } from "@/lib/db";
import { deckCards, decks, profiles } from "@/db/schema";

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

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const name = cleanName(body.name);
  if (!name) return error("Deck name is required.");
  if (
    body.commander !== undefined &&
    body.commander !== null &&
    typeof body.commander !== "string"
  )
    return error("Commander must be a card name or null.");

  const commander = cleanName(body.commander) || null;

  // Single statement: the Deck.profileId foreign key rejects unknown profiles,
  // and RETURNING replaces the re-select.
  try {
    const [deck] = await getDb()
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
