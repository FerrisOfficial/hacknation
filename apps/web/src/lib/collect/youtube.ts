import "server-only";
import type { MlClient } from "@app/api-ml";
import type { NewMaterial } from "@app/db";
import { type YoutubeCollection, youtubeMaterialRows } from "./youtube-materials";

// Kolektor YouTube: wyszukiwanie w serwisie ML (bezstanowy) → wiersze `materials`. Zapis do bazy,
// historię zadania i kolejkę analizy robi pipeline (@/lib/pipeline/scrape).

export type YoutubeSearch = { query: string; limit: number; paidOnly: boolean };

export type YoutubeCollected = {
  rows: NewMaterial[];
  videos: number;
  paidPromotion: number;
  pages: number;
  failed: { id: string; error: string }[];
};

export function errorDetail(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "detail" in error) {
    return typeof error.detail === "string" ? error.detail : JSON.stringify(error.detail);
  }
  return undefined;
}

async function runCollector(ml: MlClient, search: YoutubeSearch): Promise<YoutubeCollection> {
  const { data, error, response } = await ml
    .POST("/collect/youtube", {
      body: {
        query: search.query,
        limit: search.limit,
        paid_only: search.paidOnly,
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

export async function collectYoutube(
  ml: MlClient,
  search: YoutubeSearch,
  ids: { sourceId: string; jobId: string },
): Promise<YoutubeCollected> {
  const collection = await runCollector(ml, search);
  const rows = youtubeMaterialRows(collection, ids, new Date());
  return {
    rows,
    videos: collection.videos.length,
    paidPromotion: collection.videos.filter((video) => video.paid_promotion).length,
    pages: rows.filter((row) => row.platform === "web").length,
    failed: collection.failed.map(({ video_id, error }) => ({ id: video_id, error })),
  };
}
