import { eq, getDb, sources } from "@app/db";
import { NextResponse } from "next/server";
import { HttpError, handler, readId } from "@/lib/api/http";
import { enqueueScrape } from "@/lib/pipeline/enqueue";

// POST /api/sources/:id/run — „uruchom teraz”: zadanie scrapingu do kolejki (poza harmonogramem).
// 202 { status: "queued", jobId } albo 200 { status: "already_queued", jobId }.
export const POST = handler(
  "sources/:id/run",
  async (_request, ctx: RouteContext<"/api/sources/[id]/run">) => {
    const id = readId((await ctx.params).id);
    const db = getDb();
    const [source] = await db.select({ id: sources.id }).from(sources).where(eq(sources.id, id));
    if (!source) throw new HttpError(404, "Nie ma takiego źródła");
    const result = await enqueueScrape(db, id, "manual");
    return NextResponse.json(result, { status: result.status === "queued" ? 202 : 200 });
  },
);
