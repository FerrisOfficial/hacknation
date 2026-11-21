import { getDb, scrapeJobs, sources } from "@app/db";
import { NextResponse } from "next/server";
import { HttpError, handler, readBody, requireCollectorToken } from "@/lib/api/http";
import { ml } from "@/lib/ml";
import { runScrapeJob, ScrapeJobError } from "@/lib/pipeline/scrape";
import { youtubeCollectInputSchema } from "@/lib/schemas";
import { sourceRow } from "@/lib/sources";

// POST /api/collect/youtube — synchronicznie: kolektor YouTube w serwisie ML + zapis do
// sources/scrape_jobs/materials + nowe materiały do kolejki analizy AI. Dla crona i skryptów:
// `Authorization: Bearer $COLLECTOR_TOKEN`, body { query, limit?, paidOnly? }.
// Dashboard używa raczej POST /api/sources (kind: youtube_search) — przez kolejkę, bez czekania.
export const POST = handler("collect/youtube", async (request) => {
  await requireCollectorToken(request);
  const input = await readBody(request, youtubeCollectInputSchema);
  const db = getDb();

  const row = sourceRow({
    kind: "youtube_search",
    ...input,
    intervalMinutes: null,
    active: true,
    runNow: false,
  });
  const [source] = await db
    .insert(sources)
    .values(row)
    .onConflictDoUpdate({ target: sources.url, set: { name: row.name, config: row.config } })
    .returning({ id: sources.id });
  if (!source) throw new Error("Nie udało się zapisać źródła");
  const [job] = await db
    .insert(scrapeJobs)
    .values({ sourceId: source.id, trigger: "api", status: "queued" })
    .returning({ id: scrapeJobs.id });
  if (!job) throw new Error("Nie udało się utworzyć zadania");

  try {
    const summary = await runScrapeJob(db, ml, job.id);
    if (!summary) throw new Error("Zadanie zniknęło w trakcie");
    return NextResponse.json({
      sourceId: summary.sourceId,
      jobId: summary.jobId,
      videos: summary.stats.videos ?? 0,
      paidPromotion: summary.stats.paidPromotion ?? 0,
      pages: summary.stats.pages ?? 0,
      analysisQueued: summary.analysisQueued,
      failed: summary.failed.map(({ id, error }) => ({ videoId: id, error })),
    });
  } catch (error) {
    if (error instanceof ScrapeJobError) {
      throw new HttpError(502, error.message, { jobId: error.jobId });
    }
    throw error;
  }
});
