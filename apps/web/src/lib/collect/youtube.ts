import "server-only";
import type { MlClient } from "@app/api-ml";
import { type Db, eq, materials, type NewMaterial, scrapeJobs, sources, sql } from "@app/db";
import type { YoutubeCollectInput } from "@/lib/schemas";
import {
  type YoutubeCollection,
  youtubeMaterialRows,
  youtubeSearchSource,
} from "./youtube-materials";

// Kolektor YouTube z zapisem: źródło (wyszukiwanie) → zadanie (scrape_jobs) → serwis ML → materiały.
// Serwis ML jest bezstanowy, więc bazę zapisujemy tutaj.

export type YoutubeCollectSummary = {
  sourceId: string;
  jobId: string;
  videos: number;
  paidPromotion: number;
  pages: number;
  failed: { videoId: string; error: string }[];
};

export class CollectError extends Error {
  constructor(
    message: string,
    readonly jobId: string,
  ) {
    super(message);
    this.name = "CollectError";
  }
}

// Przy ponownym zebraniu tego samego URL-a nadpisujemy treść i metadane najnowszą wersją.
const excluded = (column: { name: string }) => sql.raw(`excluded."${column.name}"`);

function errorDetail(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "detail" in error) {
    return typeof error.detail === "string" ? error.detail : JSON.stringify(error.detail);
  }
  return undefined;
}

async function runCollector(ml: MlClient, input: YoutubeCollectInput): Promise<YoutubeCollection> {
  const { data, error, response } = await ml
    .POST("/collect/youtube", {
      body: {
        query: input.query,
        limit: input.limit,
        paid_only: input.paidOnly,
        // Tylko tekst: napisy YouTube jako tekst, bez pobierania wideo.
        transcripts: true,
        follow_links: true,
        max_links_per_video: 5,
      },
    })
    .catch(() => {
      throw new Error("Serwis ML nie odpowiada");
    });
  if (!data) {
    const detail = errorDetail(error) ?? `HTTP ${response.status}`;
    throw new Error(`Kolektor YouTube w serwisie ML zwrócił błąd: ${detail}`);
  }
  return data;
}

async function failJob(db: Db, jobId: string, message: string): Promise<CollectError> {
  await db
    .update(scrapeJobs)
    .set({ status: "failed", finishedAt: new Date(), error: message })
    .where(eq(scrapeJobs.id, jobId));
  return new CollectError(message, jobId);
}

export async function collectYoutube(
  db: Db,
  ml: MlClient,
  input: YoutubeCollectInput,
): Promise<YoutubeCollectSummary> {
  const source = youtubeSearchSource(input.query, input.paidOnly);
  const [sourceRow] = await db
    .insert(sources)
    .values(source)
    .onConflictDoUpdate({ target: sources.url, set: { name: source.name } })
    .returning({ id: sources.id });
  if (!sourceRow) throw new Error("Nie udało się zapisać źródła");

  const [job] = await db
    .insert(scrapeJobs)
    .values({ sourceId: sourceRow.id, status: "running", startedAt: new Date() })
    .returning({ id: scrapeJobs.id });
  if (!job) throw new Error("Nie udało się utworzyć zadania");

  let collection: YoutubeCollection;
  try {
    collection = await runCollector(ml, input);
  } catch (error) {
    throw await failJob(db, job.id, error instanceof Error ? error.message : String(error));
  }

  const rows = youtubeMaterialRows(
    collection,
    { sourceId: sourceRow.id, jobId: job.id },
    new Date(),
  );
  const failed = collection.failed.map(({ video_id, error }) => ({ videoId: video_id, error }));
  try {
    await saveMaterials(db, job.id, rows, failed);
  } catch (error) {
    console.error("[collect/youtube] Zapis materiałów nie powiódł się:", error);
    throw await failJob(db, job.id, "Zapis materiałów do bazy nie powiódł się");
  }

  return {
    sourceId: sourceRow.id,
    jobId: job.id,
    videos: collection.videos.length,
    paidPromotion: collection.videos.filter((video) => video.paid_promotion).length,
    pages: rows.filter((row) => row.platform === "web").length,
    failed,
  };
}

async function saveMaterials(
  db: Db,
  jobId: string,
  rows: NewMaterial[],
  failed: YoutubeCollectSummary["failed"],
): Promise<void> {
  await db.transaction(async (tx) => {
    if (rows.length > 0) {
      await tx
        .insert(materials)
        .values(rows)
        .onConflictDoUpdate({
          target: materials.url,
          set: {
            sourceId: excluded(materials.sourceId),
            jobId: excluded(materials.jobId),
            platform: excluded(materials.platform),
            title: excluded(materials.title),
            author: excluded(materials.author),
            text: excluded(materials.text),
            contentHash: excluded(materials.contentHash),
            language: excluded(materials.language),
            publishedAt: excluded(materials.publishedAt),
            scrapedAt: excluded(materials.scrapedAt),
            metadata: excluded(materials.metadata),
          },
        });
    }
    await tx
      .update(scrapeJobs)
      .set({
        status: "done",
        finishedAt: new Date(),
        // Część filmów mogła się nie pobrać — zadanie jest zrobione, ale zapisujemy dlaczego.
        error: failed.length
          ? failed.map(({ videoId, error }) => `${videoId}: ${error}`).join("\n")
          : null,
      })
      .where(eq(scrapeJobs.id, jobId));
  });
}
