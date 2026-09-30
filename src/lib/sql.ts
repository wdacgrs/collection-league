import { getTableName, sql, type Column } from "drizzle-orm";

/**
 * Render a column as `"Table"."column"` regardless of query shape.
 *
 * Drizzle omits the table qualifier in single-table SELECTs, so inside a
 * correlated subquery `${decks.id}` would render as bare `"id"` and silently
 * bind to the *inner* table's column. Use this for every column reference
 * inside a correlated subquery.
 */
export function qualified(column: Column) {
  return sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
}

/**
 * True when `err` (or anything in its `.cause` chain) is a SQLite constraint
 * violation of the given kind. Drizzle wraps single-statement failures in a
 * DrizzleQueryError whose message is only "Failed query: …"; the D1 text
 * ("UNIQUE constraint failed: …") lives on the cause.
 */
export function isConstraintError(err: unknown, kind: "UNIQUE" | "FOREIGN KEY"): boolean {
  const needle = `${kind} constraint failed`;
  for (let current = err, depth = 0; current && depth < 5; depth++) {
    if (String(current).includes(needle)) return true;
    if (current instanceof Error && current.message.includes(needle)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
