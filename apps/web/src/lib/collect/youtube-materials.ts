import type { components } from "@app/api-ml";
import type { NewMaterial } from "@app/db";

// Czyste mapowanie (bez bazy i sieci): wynik kolektora YouTube z serwisu ML → wiersze `materials`.

export type YoutubeCollection = components["schemas"]["YoutubeCollection"];
type YoutubeVideo = components["schemas"]["YoutubeVideo"];
type YoutubeLinkedPage = components["schemas"]["YoutubeLinkedPage"];
type ScrapedPage = YoutubeLinkedPage & { text: string; content_hash: string };

// Filtr wyszukiwarki YouTube „Zawiera płatną promocję” — ten sam co w services/ml/src/ml/youtube.py.
const PAID_PROMOTION_FILTER = "EgOAAgE=";

// Monitorowane wyszukiwanie = źródło (`sources`). Ten sam adres co wyszukiwanie w serwisie ML,
// więc kolejne uruchomienia tej samej frazy trafiają do jednego źródła.
export function youtubeSearchSource(query: string, paidOnly: boolean) {
  const params = new URLSearchParams({ search_query: query });
  if (paidOnly) params.set("sp", PAID_PROMOTION_FILTER);
  return {
    platform: "youtube" as const,
    url: `https://www.youtube.com/results?${params}`,
    name: `YouTube: „${query}”${paidOnly ? " (płatne promocje)" : ""}`,
  };
}

function videoRow(video: YoutubeVideo, query: string): NewMaterial {
  return {
    platform: "youtube",
    url: video.url,
    title: video.title,
    author: video.channel,
    text: video.text,
    contentHash: video.content_hash,
    language: video.transcript?.language ?? null,
    publishedAt: video.published_at ? new Date(video.published_at) : null,
    metadata: {
      kind: "youtube_video",
      query,
      video_id: video.video_id,
      channel_id: video.channel_id,
      channel_url: video.channel_url,
      paid_promotion: video.paid_promotion,
      promo_codes: video.promo_codes,
      description: video.description,
      keywords: video.keywords,
      category: video.category,
      duration_s: video.duration_s,
      view_count: video.view_count,
      is_unlisted: video.is_unlisted,
      // Bez tekstu stron — pobrane strony są osobnymi materiałami (url = final_url).
      links: video.links.map((link) => ({
        url: link.url,
        domain: link.domain,
        followed: link.followed,
        final_url: link.final_url,
        final_domain: link.final_domain,
        error: link.error,
      })),
      transcript: video.transcript
        ? {
            language: video.transcript.language,
            is_generated: video.transcript.is_generated,
            segments: video.transcript.segments,
          }
        : null,
      transcript_error: video.transcript_error,
    },
  };
}

function pageRow(page: ScrapedPage, foundIn: string[]): NewMaterial {
  return {
    platform: "web",
    url: page.final_url ?? page.url,
    title: page.title,
    author: null,
    text: page.text,
    contentHash: page.content_hash,
    metadata: {
      kind: "linked_page",
      link_url: page.url,
      domain: page.final_domain ?? page.domain,
      // Filmy, w których opisie był link do tej strony.
      found_in: foundIn,
    },
  };
}

function isScrapedPage(link: YoutubeLinkedPage): link is ScrapedPage {
  return link.followed && !link.error && Boolean(link.text) && Boolean(link.content_hash);
}

// Filmy i pobrane strony z ich opisów. Każdy URL raz (upsert w Postgresie nie może dotknąć
// tego samego wiersza dwa razy w jednym zapytaniu).
export function youtubeMaterialRows(
  collection: YoutubeCollection,
  ids: { sourceId: string; jobId: string },
  scrapedAt: Date,
): NewMaterial[] {
  const videos = new Map<string, NewMaterial>();
  const pages = new Map<string, { page: ScrapedPage; foundIn: string[] }>();
  for (const video of collection.videos) {
    if (!videos.has(video.url)) videos.set(video.url, videoRow(video, collection.query));
    for (const page of video.links.filter(isScrapedPage)) {
      const url = page.final_url ?? page.url;
      const entry = pages.get(url) ?? { page, foundIn: [] };
      if (!entry.foundIn.includes(video.url)) entry.foundIn.push(video.url);
      pages.set(url, entry);
    }
  }
  const pageRows = [...pages.entries()]
    .filter(([url]) => !videos.has(url))
    .map(([, { page, foundIn }]) => pageRow(page, foundIn));
  return [...videos.values(), ...pageRows].map((row) => ({ ...row, ...ids, scrapedAt }));
}
