import { desc, eq, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "./db";
import { decks, matches, profiles } from "@/db/schema";

const winner = alias(profiles, "winner");
const loser = alias(profiles, "loser");
const winnerDeck = alias(decks, "winnerDeck");
const loserDeck = alias(decks, "loserDeck");

/**
 * Match rows joined with player names/icons and deck names in a single
 * statement (replaces match → players → decks round trips). Ordered newest
 * first; the global feed walks Match_createdAt_id_idx.
 */
export function matchFeedQuery(db: Db, profileId?: string) {
  const query = db
    .select({
      id: matches.id,
      winnerId: matches.winnerId,
      winnerName: sql<string>`coalesce(${winner.name}, '')`,
      winnerIconCard: winner.iconCard,
      loserId: matches.loserId,
      loserName: sql<string>`coalesce(${loser.name}, '')`,
      loserIconCard: loser.iconCard,
      winnerDeckName: winnerDeck.name,
      loserDeckName: loserDeck.name,
      note: matches.note,
      createdAt: matches.createdAt,
    })
    .from(matches)
    .leftJoin(winner, eq(winner.id, matches.winnerId))
    .leftJoin(loser, eq(loser.id, matches.loserId))
    .leftJoin(winnerDeck, eq(winnerDeck.id, matches.winnerDeckId))
    .leftJoin(loserDeck, eq(loserDeck.id, matches.loserDeckId));
  return (
    profileId
      ? query.where(or(eq(matches.winnerId, profileId), eq(matches.loserId, profileId)))
      : query
  ).orderBy(desc(matches.createdAt), desc(matches.id));
}

/**
 * Per-opponent win/loss totals for one profile, aggregated in SQL over the
 * profile's full history (independent of any feed LIMIT).
 */
export function headToHeadQuery(db: Db, profileId: string) {
  const opponentId = sql<string>`case when ${matches.winnerId} = ${profileId} then ${matches.loserId} else ${matches.winnerId} end`;
  const opponent = alias(profiles, "opponent");
  return db
    .select({
      opponentId: sql<string>`${opponentId}`.as("opponentId"),
      opponentName: sql<string>`coalesce(${opponent.name}, '')`,
      opponentIconCard: opponent.iconCard,
      wins: sql<number>`sum(case when ${matches.winnerId} = ${profileId} then 1 else 0 end)`,
      losses: sql<number>`sum(case when ${matches.loserId} = ${profileId} then 1 else 0 end)`,
    })
    .from(matches)
    .leftJoin(opponent, eq(opponent.id, opponentId))
    .where(or(eq(matches.winnerId, profileId), eq(matches.loserId, profileId)))
    .groupBy(opponentId);
}
