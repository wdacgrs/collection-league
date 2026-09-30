import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { cleanName, error } from "@/lib/api";
import { matchFeedQuery } from "@/lib/match-feed";
import { getDb } from "@/lib/db";
import { decks, matches, profiles } from "@/db/schema";

export async function GET() {
  // One statement: matches joined with players and decks.
  const rows = await matchFeedQuery(getDb()).limit(100);
  return NextResponse.json({ matches: rows });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const winnerId = cleanName(body.winnerId);
  const loserId = cleanName(body.loserId);
  if (!winnerId || !loserId) return error("Winner and loser are required.");
  if (winnerId === loserId) return error("Winner and loser must be different players.");
  const winnerDeckId = body.winnerDeckId == null ? null : cleanName(body.winnerDeckId);
  const loserDeckId = body.loserDeckId == null ? null : cleanName(body.loserDeckId);
  if ((body.winnerDeckId != null && !winnerDeckId) || (body.loserDeckId != null && !loserDeckId)) {
    return error("Deck ids must be non-empty strings or null.");
  }
  if (body.note != null && typeof body.note !== "string") return error("Note must be a string.");
  if (typeof body.note === "string" && body.note.length > 200) return error("Note must be 200 characters or fewer.");
  const note = cleanName(body.note) || null;
  const db = getDb();
  const deckIds = [winnerDeckId, loserDeckId].filter((id): id is string =>
    Boolean(id),
  );

  // Round trip 1: players + decks (with names, so no re-read after insert).
  const profileQuery = db
    .select({
      id: profiles.id,
      name: profiles.name,
      iconCard: profiles.iconCard,
    })
    .from(profiles)
    .where(inArray(profiles.id, [winnerId, loserId]));
  const [profileRows, deckRows] = deckIds.length
    ? await db.batch([
        profileQuery,
        db
          .select({
            id: decks.id,
            profileId: decks.profileId,
            name: decks.name,
          })
          .from(decks)
          .where(inArray(decks.id, deckIds)),
      ])
    : [await profileQuery, []];
  const players = new Map(profileRows.map((profile) => [profile.id, profile]));
  const winner = players.get(winnerId);
  const loser = players.get(loserId);
  if (!winner || !loser)
    return error("Winner and loser must be existing profiles.");
  const deckById = new Map(deckRows.map((deck) => [deck.id, deck]));
  if (winnerDeckId && deckById.get(winnerDeckId)?.profileId !== winnerId)
    return error("Winner deck must belong to the winner.");
  if (loserDeckId && deckById.get(loserDeckId)?.profileId !== loserId)
    return error("Loser deck must belong to the loser.");

  // Round trip 2: insert.
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db
    .insert(matches)
    .values({
      id,
      winnerId,
      loserId,
      winnerDeckId,
      loserDeckId,
      note,
      createdAt,
    });
  return NextResponse.json(
    {
      match: {
        id,
        winnerId,
        winnerName: winner.name,
        winnerIconCard: winner.iconCard,
        loserId,
        loserName: loser.name,
        loserIconCard: loser.iconCard,
        winnerDeckName: winnerDeckId
          ? (deckById.get(winnerDeckId)?.name ?? null)
          : null,
        loserDeckName: loserDeckId
          ? (deckById.get(loserDeckId)?.name ?? null)
          : null,
        note,
        createdAt,
      },
    },
    { status: 201 },
  );
}
