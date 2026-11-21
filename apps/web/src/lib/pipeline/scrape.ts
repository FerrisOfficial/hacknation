import "server-only";
import type { MlClient } from "@app/api-ml";
import { type Db, eq, type NewMaterial, type Source, scrapeJobs, sources } from "@app/db";
import { normalizeDomain } from "@/lib/analysis/entity";
import { collectYoutube, collectYoutubeChannel, errorDetail } from "@/lib/collect/youtube";
import { putContent } from "@/lib/content-store";
import { publishEventSafe } from "@/lib/realtime/publish";
import { sourceConfig } from "@/lib/sources";
import { enqueueAnalysis } from "./enqueue";
import { upsertMaterials } from "./materials";

// Jedno uruchomienie scrapera (wiersz `scrape_jobs`): źródło → kolektor w serwisie ML → materiały
// w bazie (treść HTML do content store) → nowe/zmienione materiały do kolejki analizy AI.
// Woła to worker kolejki (`scrape-source`) i synchroniczny POST /api/collect/youtube.

export type ScrapeSummary = {
  jobId: string;
  sourceId: string;
  materials: number;
  analysisQueued: number;
  // Elementy, których nie udało się pobrać (np. film bez dostępu) — zadanie i tak jest „done”.
  failed: { id: string; error: string }[];
  stats: Record<string, number>;
};

export class ScrapeJobError extends Error {
  constructor(
    message: string,
    readonly jobId: string,
  ) {
    super(message);
    this.name = "ScrapeJobError";
  }
}

type Collected = {
  rows: NewMaterial[];
  failed: ScrapeSummary["failed"];
  stats: Record<string, number>;
};

async function scrapeWebPage(
  ml: MlClient,
  source: Source,
  ids: { sourceId: string; jobId: string },
): Promise<Collected> {
  const { data, error, response } = await ml
    .POST("/scrape", { body: { url: source.url, include_html: true } })
    .catch(() => {
      throw new Error("Serwis ML nie odpowiada");
    });
  if (!data) {
    throw new Error(`Scraper zwrócił błąd: ${errorDetail(error) ?? `HTTP ${response.status}`}`);
  }
  const contentRef = data.html ? await putContent(data.html) : null;
  const row: NewMaterial = {
    ...ids,
    platform: source.platform,
    url: data.final_url,
    title: data.title,
    author: data.author,
    text: data.text,
    contentHash: data.content_hash,
    contentRef,
    language: data.language,
    scrapedAt: new Date(data.fetched_at),
    metadata: {
      kind: "web_page",
      requested_url: data.url,
      status_code: data.status_code,
      description: data.description,
      user_agent: data.user_agent,
      // Linki wychodzące, ten sam kształt co `links` filmu (moduł 1 szuka w nich firmy).
      links: (data.links ?? []).map((url) => ({ url, domain: normalizeDomain(url) })),
    },
  };
  return { rows: [row], failed: [], stats: { pages: 1 } };
}

async function collect(
  ml: MlClient,
  source: Source,
  ids: { sourceId: string; jobId: string },
): Promise<Collected> {
  const config = sourceConfig(source);
  if (config.kind === "youtube_search") {
    const result = await collectYoutube(ml, config, ids);
    return {
      rows: result.rows,
      failed: result.failed,
      stats: { videos: result.videos, paidPromotion: result.paidPromotion, pages: result.pages },
    };
  }
  if (config.kind === "youtube_channel") {
    const result = await collectYoutubeChannel(ml, config, ids);
    return {
      rows: result.rows,
      failed: result.failed,
      stats: { videos: result.videos, paidPromotion: result.paidPromotion, pages: result.pages },
    };
  }
  return scrapeWebPage(ml, source, ids);
}

async function finishJob(
  db: Db,
  job: { id: string; sourceId: string },
  outcome:
    | { status: "done"; materials: number; analysisQueued: number; error: string | null }
    | { status: "failed"; error: string },
): Promise<void> {
  const now = new Date();
  const counts =
    outcome.status === "done"
      ? { materialsCount: outcome.materials, analysisQueued: outcome.analysisQueued }
      : {};
  await db
    .update(scrapeJobs)
    .set({ status: outcome.status, finishedAt: now, error: outcome.error, ...counts })
    .where(eq(scrapeJobs.id, job.id));
  // Termin następnego uruchomienia z harmonogramu liczymy od końca tego (także nieudanego).
  await db.update(sources).set({ lastScrapedAt: now }).where(eq(sources.id, job.sourceId));
  await publishEventSafe(db, {
    type: "job",
    jobId: job.id,
    sourceId: job.sourceId,
    status: outcome.status,
    materialsCount: outcome.status === "done" ? outcome.materials : null,
    analysisQueued: outcome.status === "done" ? outcome.analysisQueued : null,
    error: outcome.error,
  });
}

export async function runScrapeJob(
  db: Db,
  ml: MlClient,
  jobId: string,
): Promise<ScrapeSummary | null> {
  const [row] = await db
    .select({ job: scrapeJobs, source: sources })
    .from(scrapeJobs)
    .innerJoin(sources, eq(sources.id, scrapeJobs.sourceId))
    .where(eq(scrapeJobs.id, jobId));
  // Źródło usunięte w międzyczasie (kaskada usunęła zadanie) albo zadanie już zrobione.
  if (!row || row.job.status === "done") return null;
  const { job, source } = row;

  await db
    .update(scrapeJobs)
    .set({ status: "running", startedAt: new Date(), finishedAt: null, error: null })
    .where(eq(scrapeJobs.id, job.id));
  await publishEventSafe(db, {
    type: "job",
    jobId: job.id,
    sourceId: source.id,
    status: "running",
    materialsCount: null,
    analysisQueued: null,
    error: null,
  });

  let collected: Collected;
  try {
    collected = await collect(ml, source, { sourceId: source.id, jobId: job.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishJob(db, job, { status: "failed", error: message });
    throw new ScrapeJobError(message, job.id);
  }

  let analysisQueued = 0;
  let saved: Awaited<ReturnType<typeof upsertMaterials>>;
  try {
    saved = await upsertMaterials(db, collected.rows);
  } catch (error) {
    console.error("[scrape] Zapis materiałów nie powiódł się:", error);
    await finishJob(db, job, {
      status: "failed",
      error: "Zapis materiałów do bazy nie powiódł się",
    });
    throw new ScrapeJobError("Zapis materiałów do bazy nie powiódł się", job.id);
  }
  try {
    analysisQueued = await enqueueAnalysis(saved.filter((m) => m.needsAnalysis).map((m) => m.id));
  } catch (error) {
    // Materiały są zapisane — analizę można dołożyć później (POST /api/materials/:id/analyze).
    console.error("[scrape] Nie udało się dodać materiałów do kolejki analizy:", error);
  }

  const failedText = collected.failed.map(({ id, error }) => `${id}: ${error}`).join("\n");
  await finishJob(db, job, {
    status: "done",
    materials: saved.length,
    analysisQueued,
    error: failedText || null,
  });
  return {
    jobId: job.id,
    sourceId: source.id,
    materials: saved.length,
    analysisQueued,
    failed: collected.failed,
    stats: collected.stats,
  };
}
