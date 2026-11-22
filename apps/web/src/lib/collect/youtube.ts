import "server-only";
import type { MlClient } from "@app/api-ml";
import type { NewMaterial } from "@app/db";
import { putContent } from "@/lib/content-store";
import { linkedPageHtml, type YoutubeCollection, youtubeMaterialRows } from "./youtube-materials";

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

export type YoutubeChannel = { channelUrl: string; limit: number };

async function runChannelCollector(
  ml: MlClient,
  channel: YoutubeChannel,
): Promise<YoutubeCollection> {
  const { data, error, response } = await ml
    .POST("/collect/youtube/channel", {
      body: {
        channel_url: channel.channelUrl,
        limit: channel.limit,
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
    throw new Error(`Kolektor kanału YouTube w serwisie ML zwrócił błąd: ${detail}`);
  }
  return data;
}

// Kopie HTML stron z linków do bazy treści (jak strony WWW w @/lib/pipeline/scrape) — bez nich
// Okno sprawy nie ma kopii strony z dnia pobrania, a M2 nie sprawdzi reguł 7 i 8 dla strony.
// Błąd zapisu jednej kopii nie przerywa zbioru — strona zostaje bez kopii (`contentRef` null).
async function storeLinkedPages(collection: YoutubeCollection): Promise<Map<string, string>> {
  const stored = await Promise.all(
    [...linkedPageHtml(collection)].map(async ([url, html]) => {
      try {
        return [url, await putContent(html)] as const;
      } catch (error) {
        console.error(`[collect] Nie zapisano kopii HTML ${url}:`, error);
        return null;
      }
    }),
  );
  return new Map(stored.filter((entry) => entry !== null));
}

async function summarize(
  collection: YoutubeCollection,
  ids: { sourceId: string; jobId: string },
): Promise<YoutubeCollected> {
  const rows = youtubeMaterialRows(collection, ids, new Date(), await storeLinkedPages(collection));
  return {
    rows,
    videos: collection.videos.length,
    paidPromotion: collection.videos.filter((video) => video.paid_promotion).length,
    pages: rows.filter((row) => row.platform === "web").length,
    failed: collection.failed.map(({ video_id, error }) => ({ id: video_id, error })),
  };
}

// Najnowsze filmy kanału (wszystkie, nie tylko płatne promocje) — źródło `youtube_channel`.
export async function collectYoutubeChannel(
  ml: MlClient,
  channel: YoutubeChannel,
  ids: { sourceId: string; jobId: string },
): Promise<YoutubeCollected> {
  return summarize(await runChannelCollector(ml, channel), ids);
}

export async function collectYoutube(
  ml: MlClient,
  search: YoutubeSearch,
  ids: { sourceId: string; jobId: string },
): Promise<YoutubeCollected> {
  return summarize(await runCollector(ml, search), ids);
}
