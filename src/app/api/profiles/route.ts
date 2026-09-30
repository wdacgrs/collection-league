import { NextResponse } from "next/server";
import { isConstraintError, qualified } from "@/lib/sql";
import { inArray, sql } from "drizzle-orm";
import { cleanName, error } from "@/lib/api";
import { chunksOf } from "@/lib/chunks";
import { getDb } from "@/lib/db";
import { catalog, collectionCards, decks, profiles } from "@/db/schema";

export async function GET(request: Request) {
  const db = getDb();
  const base = {
    id: profiles.id,
    name: profiles.name,
    iconCard: profiles.iconCard,
    createdAt: profiles.createdAt,
  };

  // `?counts=0` skips the aggregates for callers that only need a picker list.
  if (new URL(request.url).searchParams.get("counts") === "0") {
    const rows = await db.select(base).from(profiles).orderBy(profiles.name);
    return NextResponse.json({ profiles: rows });
  }

  // One statement: per-profile correlated subqueries use the
  // (profileId, …) indexes instead of aggregating the whole tables.
  const rows = await db
    .select({
      ...base,
      cardCount: sql<number>`coalesce((select sum(${qualified(collectionCards.qty)}) from ${collectionCards} where ${qualified(collectionCards.profileId)} = ${qualified(profiles.id)}), 0)`,
      deckCount: sql<number>`(select count(*) from ${decks} where ${qualified(decks.profileId)} = ${qualified(profiles.id)})`,
    })
    .from(profiles)
    .orderBy(profiles.name);

  return NextResponse.json({ profiles: rows });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const name = cleanName(body.name);
  if (!name) return error("Profile name is required.");
  if (body.seedCommons !== undefined && typeof body.seedCommons !== "boolean") {
    return error("seedCommons must be a boolean.");
  }
  const seedCommons = body.seedCommons ?? true;
  if (
    body.iconCard !== undefined &&
    body.iconCard !== null &&
    typeof body.iconCard !== "string"
  ) {
    return error("iconCard must be a string or null.");
  }
  const iconCard = body.iconCard ?? null;

  const db = getDb();

  // No duplicate-name pre-check: the UNIQUE index on Profile.name rejects the
  // batch below, which is caught and mapped to 409.
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  // Only the names of seedable cards, filtered in SQL.
  const seededCards = seedCommons
    ? await db
        .select({ name: catalog.name })
        .from(catalog)
        .where(inArray(catalog.rarity, ["common", "uncommon"]))
    : [];
  const statements = [
    db.insert(profiles).values({ id, name, iconCard, createdAt }),
    ...chunksOf(seededCards, 20).map((cards) =>
      db.insert(collectionCards).values(
        cards.map((card) => ({
          id: crypto.randomUUID(),
          profileId: id,
          name: card.name,
          qty: 1,
          owned: true,
        })),
      ),
    ),
  ];
  try {
    await db.batch(
      statements as [
        (typeof statements)[number],
        ...(typeof statements)[number][],
      ],
    );
  } catch (cause) {
    if (isConstraintError(cause, "UNIQUE")) {
      return error("A profile with that name already exists.", 409);
    }
    throw cause;
  }

  const profile = { id, name, iconCard, createdAt };
  return NextResponse.json({ profile }, { status: 201 });
}
