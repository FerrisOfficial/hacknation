import type { NewSource, Platform, Source, SourceConfig } from "@app/db";
import { youtubeSearchSource } from "@/lib/collect/youtube-materials";
import type { SourceCreate } from "@/lib/schemas";

// Czyste mapowanie (bez bazy): formularz „dodaj źródło” → wiersz `sources`.

const PLATFORM_DOMAINS: [Platform, string[]][] = [
  ["facebook", ["facebook.com", "fb.com", "fb.watch"]],
  ["instagram", ["instagram.com"]],
  ["tiktok", ["tiktok.com"]],
  ["youtube", ["youtube.com", "youtu.be"]],
  ["x", ["x.com", "twitter.com"]],
  ["linkedin", ["linkedin.com"]],
  ["telegram", ["t.me", "telegram.me", "telegram.org"]],
];

export function detectPlatform(url: string): Platform {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  for (const [platform, domains] of PLATFORM_DOMAINS) {
    if (domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return platform;
  }
  return "web";
}

// Źródła YouTube zapisane przed kolumną `config` (migracja 0004) mają domyślne `web_page` —
// konfigurację kolektora odczytujemy wtedy z adresu wyszukiwarki.
export function sourceConfig(source: Pick<Source, "platform" | "url" | "config">): SourceConfig {
  if (source.config.kind !== "web_page" || source.platform !== "youtube") return source.config;
  const url = new URL(source.url);
  const query = url.searchParams.get("search_query");
  if (url.pathname !== "/results" || !query) return source.config;
  return { kind: "youtube_search", query, limit: 10, paidOnly: url.searchParams.has("sp") };
}

export function sourceRow(input: SourceCreate): NewSource {
  if (input.kind === "youtube_search") {
    const search = youtubeSearchSource(input.query, input.paidOnly);
    return {
      ...search,
      name: input.name ?? search.name,
      active: input.active,
      intervalMinutes: input.intervalMinutes,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      config: {
        kind: "youtube_search",
        query: input.query,
        limit: input.limit,
        paidOnly: input.paidOnly,
      },
    };
  }
  const url = new URL(input.url);
  url.hash = "";
  return {
    platform: input.platform ?? detectPlatform(input.url),
    url: url.toString(),
    name: input.name ?? url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/$/, ""),
    active: input.active,
    intervalMinutes: input.intervalMinutes,
    scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
    config: { kind: "web_page" },
  };
}
