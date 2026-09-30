import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { error } from "@/lib/api";
import { headToHeadQuery, matchFeedQuery } from "@/lib/match-feed";
import { getDb } from "@/lib/db";
import { profiles } from "@/db/schema";

type Context = { params: Promise<{ id: string }> };

/** Most recent matches returned in the list; record/head-to-head cover all. */
const FEED_LIMIT = 100;

export async function GET(_: Request, { params }: Context) {
  const { id } = await params;
  const db = getDb();

  // One round trip: profile, recent joined feed, and SQL-aggregated head-to-head.
  const [profileRows, recent, headToHead] = await db.batch([
    db
      .select({ id: profiles.id, name: profiles.name })
      .from(profiles)
      .where(eq(profiles.id, id))
      .limit(1),
    matchFeedQuery(db, id).limit(FEED_LIMIT),
    headToHeadQuery(db, id),
  ]);
  const profile = profileRows[0];
  if (!profile) return error("Profile not found.", 404);

  const wins = headToHead.reduce((sum, row) => sum + row.wins, 0);
  const losses = headToHead.reduce((sum, row) => sum + row.losses, 0);
  return NextResponse.json({
    profile,
    matches: recent,
    record: { wins, losses },
    headToHead: headToHead.sort((a, b) =>
      a.opponentName.localeCompare(b.opponentName),
    ),
  });
}
