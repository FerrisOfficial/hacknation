import type { NewSource } from "@app/db";
import { z } from "zod";
import { BRANDS, m1SearchQueries } from "@/lib/analysis/brands";
import { youtubeSearchSource } from "@/lib/collect/youtube-materials";

// Źródła modułu 1 (czyste mapowanie, bez bazy):
// 1. frazy „{marka} kod / polecam / jak założyć konto / recenzja” dla marek z `BRANDS` — wszystkie
//    filmy, nie tylko z etykietą płatnej promocji, odświeżane z harmonogramu;
// 2. kanał YouTube, w którym M1 znalazł reklamę — obserwowany na stałe (kula śniegowa).

export const M1_SEARCH_INTERVAL_MINUTES = 12 * 60;
export const M1_SEARCH_LIMIT = 10;
export const M1_CHANNEL_INTERVAL_MINUTES = 24 * 60;
export const M1_CHANNEL_LIMIT = 15;

export function m1SearchSourceRows(): NewSource[] {
  return m1SearchQueries(BRANDS).map((query) => {
    const search = youtubeSearchSource(query, false);
    return {
      ...search,
      name: `M1: „${query}”`,
      active: true,
      intervalMinutes: M1_SEARCH_INTERVAL_MINUTES,
      config: { kind: "youtube_search", query, limit: M1_SEARCH_LIMIT, paidOnly: false },
    };
  });
}

const channelMetadataSchema = z.object({
  kind: z.literal("youtube_video"),
  channel_url: z.string().url(),
});

const CHANNEL_URL = /^https:\/\/(?:www\.|m\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{22})/;

// Adres kanału filmu z `materials.metadata` (kolektor YouTube), znormalizowany. null, gdy brak.
export function channelUrlOf(metadata: Record<string, unknown>): string | null {
  const parsed = channelMetadataSchema.safeParse(metadata);
  if (!parsed.success) return null;
  const match = CHANNEL_URL.exec(parsed.data.channel_url);
  return match ? `https://www.youtube.com/${match[1]}` : null;
}

export function youtubeChannelSourceRow(channelUrl: string, channel: string | null): NewSource {
  return {
    platform: "youtube",
    url: channelUrl,
    name: `M1 kanał: ${channel ?? channelUrl.replace("https://www.youtube.com/", "")}`,
    active: true,
    intervalMinutes: M1_CHANNEL_INTERVAL_MINUTES,
    config: { kind: "youtube_channel", channelUrl, limit: M1_CHANNEL_LIMIT },
  };
}
