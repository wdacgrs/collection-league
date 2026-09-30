import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { error } from "@/lib/api";
import { getDb } from "@/lib/db";
import { matches } from "@/db/schema";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_: Request, { params }: Context) {
  const { id } = await params;
  // DELETE ... RETURNING doubles as the existence check.
  const deleted = await getDb()
    .delete(matches)
    .where(eq(matches.id, id))
    .returning({ id: matches.id });
  if (!deleted.length) return error("Match not found.", 404);
  return NextResponse.json({ deleted: true });
}
