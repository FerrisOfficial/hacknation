import { eq, getDb, sources } from "@app/db";
import { NextResponse } from "next/server";
import { HttpError, handler, readBody, readId } from "@/lib/api/http";
import { getSource } from "@/lib/queries/sources";
import { sourceUpdateSchema } from "@/lib/schemas";

type Context = RouteContext<"/api/sources/[id]">;

export const GET = handler("sources/:id", async (_request, ctx: Context) => {
  const source = await getSource(getDb(), readId((await ctx.params).id));
  if (!source) throw new HttpError(404, "Nie ma takiego źródła");
  return NextResponse.json(source);
});

// PATCH /api/sources/:id — { name?, active?, intervalMinutes? } (null = bez harmonogramu).
export const PATCH = handler("sources/:id", async (request, ctx: Context) => {
  const id = readId((await ctx.params).id);
  const input = await readBody(request, sourceUpdateSchema);
  const db = getDb();
  const [updated] = await db
    .update(sources)
    .set(input)
    .where(eq(sources.id, id))
    .returning({ id: sources.id });
  if (!updated) throw new HttpError(404, "Nie ma takiego źródła");
  return NextResponse.json(await getSource(db, id));
});

// DELETE /api/sources/:id — usuwa źródło i historię zadań. Materiały zostają (source_id = null),
// bo mogą mieć wyniki analiz i decyzje analityków.
export const DELETE = handler("sources/:id", async (_request, ctx: Context) => {
  const id = readId((await ctx.params).id);
  const [deleted] = await getDb()
    .delete(sources)
    .where(eq(sources.id, id))
    .returning({ id: sources.id });
  if (!deleted) throw new HttpError(404, "Nie ma takiego źródła");
  return new NextResponse(null, { status: 204 });
});
