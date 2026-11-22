import { eq, getDb, type NewSource, sources } from "@app/db";
import { NextResponse } from "next/server";
import { HttpError, handler, readBody, readId } from "@/lib/api/http";
import { youtubeSearchSource } from "@/lib/collect/youtube-materials";
import { getSource } from "@/lib/queries/sources";
import { sourceUpdateSchema } from "@/lib/schemas";
import { detectPlatform, sourceConfig } from "@/lib/sources";

type Context = RouteContext<"/api/sources/[id]">;

export const GET = handler("sources/:id", async (_request, ctx: Context) => {
  const source = await getSource(getDb(), readId((await ctx.params).id));
  if (!source) throw new HttpError(404, "Nie ma takiego źródła");
  return NextResponse.json(source);
});

// PATCH /api/sources/:id — { name?, active?, intervalMinutes?, scheduledAt?, query?, url? }.
// `query` zmienia frazę źródła YouTube, `url` adres strony WWW.
export const PATCH = handler("sources/:id", async (request, ctx: Context) => {
  const id = readId((await ctx.params).id);
  const { query, url, scheduledAt, ...rest } = await readBody(request, sourceUpdateSchema);
  const db = getDb();
  const [current] = await db.select().from(sources).where(eq(sources.id, id));
  if (!current) throw new HttpError(404, "Nie ma takiego źródła");
  const change: Partial<NewSource> = { ...rest };
  if (scheduledAt !== undefined) change.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
  const config = sourceConfig(current);
  if (query !== undefined) {
    if (config.kind !== "youtube_search") throw new HttpError(400, "To źródło nie ma frazy");
    const search = youtubeSearchSource(query, config.paidOnly);
    change.url = search.url;
    change.config = { ...config, query };
  }
  if (url !== undefined) {
    if (config.kind !== "web_page") throw new HttpError(400, "To źródło nie ma adresu strony");
    const clean = new URL(url);
    clean.hash = "";
    change.url = clean.toString();
    change.platform = detectPlatform(change.url);
  }
  const [updated] = await db
    .update(sources)
    .set(change)
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
