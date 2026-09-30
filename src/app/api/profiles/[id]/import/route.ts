import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { error } from "@/lib/api";
import { getDb } from "@/lib/db";
import { chunksOf } from "@/lib/chunks";
import { catalog, collectionCards, profiles } from "@/db/schema";

// CollectionCard has 5 columns → at most 20 rows per INSERT under D1's 100-param cap.
const D1_INSERT_BATCH = 20;

type Context = { params: Promise<{ id: string }> };

function parseLine(line: string) {
  let name = line.trim();
  if (!name) return null;

  const quantity = name.match(/^(\d+)(?:x)?\s+(.+)$/i);
  const qty = quantity ? Number(quantity[1]) : 1;
  if (quantity) name = quantity[2];

  const setCode = name.match(/\s+\([A-Za-z0-9]+\)/);
  if (setCode?.index !== undefined) {
    name = name.slice(0, setCode.index);
  } else {
    name = name
      .replace(/\s+\[[^\]]*\]\s*$/, "")
      .replace(/\s+\*[^*]+\*\s*$/, "")
      .replace(/\s+\d+\s*$/, "");
  }

  name = name.trim().replace(/[\s,;:.!?-]+$/, "");
  return qty > 0 && name ? { qty, name } : null;
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (typeof body.text !== "string" || !body.text.trim()) return error("Import text is required.");

  const db = getDb();

  // Round trip 1: profile existence + catalog names for canonicalization
  // (an import resolves many names, so loading the catalog once is right here).
  const [profileRows, catalogRows] = await db.batch([
    db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, id)).limit(1),
    db.select({ name: catalog.name }).from(catalog),
  ]);
  if (!profileRows.length) return error("Profile not found.", 404);

  const known = new Map(catalogRows.map((card) => [card.name.toLocaleLowerCase(), card.name]));
  const merged = new Map<string, { name: string; qty: number; known: boolean }>();
  for (const line of body.text.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const canonical = known.get(parsed.name.toLocaleLowerCase());
    const name = canonical ?? parsed.name;
    const key = name.toLocaleLowerCase();
    const prior = merged.get(key);
    merged.set(key, { name, qty: (prior?.qty ?? 0) + parsed.qty, known: Boolean(canonical) });
  }
  if (!merged.size) return error("No valid card lines were found.");

  const entries = [...merged.values()];

  // Round trip 2, one atomic batch: read which names already exist (for the
  // added/updated counts), then upsert everything. D1 caps statements at 100
  // bound params: 99 names + profileId per SELECT, 20 rows × 5 cols per INSERT.
  const existingQueries = chunksOf(entries.map((e) => e.name), 99).map((nameChunk) =>
    db.select({ name: collectionCards.name }).from(collectionCards).where(
      and(eq(collectionCards.profileId, id), inArray(collectionCards.name, nameChunk)),
    ),
  );
  const upserts = chunksOf(entries, D1_INSERT_BATCH).map((chunk) =>
    db.insert(collectionCards)
      .values(chunk.map((e) => ({ id: crypto.randomUUID(), profileId: id, name: e.name, qty: e.qty, owned: true })))
      .onConflictDoUpdate({
        target: [collectionCards.profileId, collectionCards.name],
        set: { qty: sql`${collectionCards.qty} + excluded."qty"` },
      }),
  );
  const statements = [...existingQueries, ...upserts];
  const results = await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);

  const existingNames = new Set(
    (results.slice(0, existingQueries.length) as { name: string }[][]).flat().map((row) => row.name),
  );
  const updated = entries.filter((e) => existingNames.has(e.name)).length;

  return NextResponse.json({
    added: entries.length - updated,
    updated,
    unknown: entries.filter((e) => !e.known).map((e) => e.name),
  });
}
