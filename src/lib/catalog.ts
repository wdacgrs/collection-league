import { asc, eq, sql } from "drizzle-orm";
import { chunksOf } from "./chunks";
import { isConstraintError, qualified } from "./sql";
import { getDb, type Db } from "./db";
import { catalog as catalogTable } from "@/db/schema";
import {
  catalogSeedData,
  parseCatalogCard,
  validateCatalog,
  type CatalogCard,
} from "./catalog-data";

// Re-export the pure, DB-free primitives so existing imports keep working.
export { catalogSeedData, parseCatalogCard, validateCatalog };
export type { CatalogCard };

/** Raised when a create/rename would collide with an existing card name. */
export class CatalogConflictError extends Error {
  constructor(name: string) {
    super(`A card named "${name}" already exists.`);
    this.name = "CatalogConflictError";
  }
}

/** Raised when an update/delete targets a card that does not exist. */
export class CatalogNotFoundError extends Error {
  constructor(name: string) {
    super(`No card named "${name}" was found.`);
    this.name = "CatalogNotFoundError";
  }
}

// Catalog has 7 columns; D1 caps a statement at 100 bound params, so a
// multi-row INSERT may carry at most floor(100 / 7) = 14 rows.
const D1_CATALOG_BATCH = 14;

const CATALOG_COLUMNS = {
  name: catalogTable.name,
  qty: catalogTable.qty,
  img: catalogTable.img,
  colors: catalogTable.colors,
  rarity: catalogTable.rarity,
  type: catalogTable.type,
  colorIdentity: catalogTable.colorIdentity,
};

function toRow(card: CatalogCard) {
  return {
    name: card.name,
    qty: card.qty,
    img: card.img,
    colors: card.colors,
    rarity: card.rarity,
    type: card.type,
    colorIdentity: card.colorIdentity,
  };
}

/**
 * Read the full catalog from the database, ordered by name.
 * Runtime source of truth after the migration off the bundled JSON.
 */
export async function getCatalog(db: Db = getDb()): Promise<CatalogCard[]> {
  return catalogQuery(db);
}

/** Un-awaited full-catalog query, so callers can include it in `db.batch`. */
export function catalogQuery(db: Db) {
  return db
    .select(CATALOG_COLUMNS)
    .from(catalogTable)
    .orderBy(asc(catalogTable.name));
}

/**
 * Resolve a user-typed name to its canonical catalog name with a single
 * indexed lookup (Catalog_name_nocase_idx), or null when not in the catalog.
 * Prefer this over `catalogNames()` when resolving one name: it reads one row
 * instead of the whole table. Note NOCASE folds ASCII letters only.
 */
export async function resolveCatalogName(
  name: string,
  db: Db = getDb(),
): Promise<string | null> {
  const rows = await catalogNameQuery(db, name);
  return rows[0]?.name ?? null;
}

/** Un-awaited form of `resolveCatalogName`, for use inside `db.batch`. */
export function catalogNameQuery(db: Db, name: string) {
  return db
    .select({ name: catalogTable.name })
    .from(catalogTable)
    .where(sql`${catalogTable.name} = ${name} COLLATE NOCASE`)
    .limit(1);
}

/**
 * SQL scalar resolving `name` to its canonical catalog name, falling back to
 * `name` itself. Lets a query filter by canonical name in the same statement
 * (and the same D1 round trip) as the lookup.
 */
export function canonicalNameExpr(name: string) {
  return sql<string>`coalesce((select ${qualified(catalogTable.name)} from ${catalogTable} where ${qualified(catalogTable.name)} = ${name} COLLATE NOCASE limit 1), ${name})`;
}

/** Fetch a single card by exact name, or null when absent. */
export async function getCatalogCard(
  name: string,
  db: Db = getDb(),
): Promise<CatalogCard | null> {
  const rows = await db
    .select(CATALOG_COLUMNS)
    .from(catalogTable)
    .where(eq(catalogTable.name, name))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create one card. Validates the card and rejects a name that already exists.
 * @throws CatalogConflictError when the name is taken.
 */
export async function createCatalogCard(
  card: CatalogCard,
  db: Db = getDb(),
): Promise<CatalogCard> {
  validateCatalog([card]);
  // The primary key rejects duplicates; no pre-check round trip needed.
  try {
    await db.insert(catalogTable).values(toRow(card));
  } catch (cause) {
    if (isConstraintError(cause, "UNIQUE")) {
      throw new CatalogConflictError(card.name);
    }
    throw cause;
  }
  return card;
}

/**
 * Update the card identified by `originalName`. Supports renaming (when
 * `card.name` differs); a rename onto an existing name is rejected.
 * @throws CatalogNotFoundError when the target card is absent.
 * @throws CatalogConflictError when renaming onto an occupied name.
 */
export async function updateCatalogCard(
  originalName: string,
  card: CatalogCard,
  db: Db = getDb(),
): Promise<CatalogCard> {
  validateCatalog([card]);
  // One statement: RETURNING detects a missing target, and the primary key
  // rejects a rename onto an occupied name.
  let updated: { name: string }[];
  try {
    updated = await db
      .update(catalogTable)
      .set(toRow(card))
      .where(eq(catalogTable.name, originalName))
      .returning({ name: catalogTable.name });
  } catch (cause) {
    if (isConstraintError(cause, "UNIQUE")) {
      throw new CatalogConflictError(card.name);
    }
    throw cause;
  }
  if (!updated.length) throw new CatalogNotFoundError(originalName);
  return card;
}

/**
 * Delete the card with the given name.
 * @throws CatalogNotFoundError when no such card exists.
 */
export async function deleteCatalogCard(
  name: string,
  db: Db = getDb(),
): Promise<void> {
  const deleted = await db
    .delete(catalogTable)
    .where(eq(catalogTable.name, name))
    .returning({ name: catalogTable.name });
  if (!deleted.length) throw new CatalogNotFoundError(name);
}

/**
 * Replace the entire catalog with the given cards, validating first.
 * Chunked to respect the D1 100-bound-parameter limit (14 rows × 7 cols).
 * Uses a delete-then-insert batch so a failure leaves the catalog untouched.
 */
export async function replaceCatalog(
  cards: readonly CatalogCard[],
  db: Db = getDb(),
): Promise<number> {
  validateCatalog(cards);
  const statements = [
    db.delete(catalogTable),
    ...chunksOf([...cards], D1_CATALOG_BATCH).map((batch) =>
      db.insert(catalogTable).values(batch.map(toRow)),
    ),
  ];
  await db.batch(
    statements as [
      (typeof statements)[number],
      ...(typeof statements)[number][],
    ],
  );
  return cards.length;
}

/**
 * Seed the catalog table from the bundled JSON. Replaces existing rows.
 * Returns the number of rows written.
 */
export async function seedCatalog(db: Db = getDb()): Promise<number> {
  return replaceCatalog(catalogSeedData(), db);
}
