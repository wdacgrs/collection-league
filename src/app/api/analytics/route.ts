import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { buildAnalytics } from "@/lib/analytics";
import { catalogQuery } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { collectionCards, profiles } from "@/db/schema";

export async function GET() {
  const db = getDb();

  // Three independent reads in one D1 round trip.
  const [catalog, allProfiles, ownedCards] = await db.batch([
    catalogQuery(db),
    db
      .select({
        id: profiles.id,
        name: profiles.name,
        iconCard: profiles.iconCard,
      })
      .from(profiles)
      .orderBy(profiles.name),
    db
      .select({
        profileId: collectionCards.profileId,
        name: collectionCards.name,
        qty: collectionCards.qty,
      })
      .from(collectionCards)
      .where(eq(collectionCards.owned, true)),
  ]);

  return NextResponse.json(buildAnalytics(catalog, allProfiles, ownedCards));
}
