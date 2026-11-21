import type { components } from "@app/api-ml";
import { describe, expect, it } from "vitest";
import {
  type YoutubeCollection,
  youtubeMaterialRows,
  youtubeSearchSource,
} from "./youtube-materials";

type LinkedPage = components["schemas"]["YoutubeLinkedPage"];
type Video = components["schemas"]["YoutubeVideo"];

const BROKER_PAGE: LinkedPage = {
  url: "https://geolink.broker.example/abc",
  domain: "geolink.broker.example",
  followed: true,
  final_url: "https://www.broker.example/pl/konto",
  final_domain: "broker.example",
  title: "Broker — konto",
  text: "Otwórz rachunek.",
  content_hash: "hash-broker",
  error: null,
};
const INSTAGRAM: LinkedPage = {
  url: "https://www.instagram.com/kanal",
  domain: "instagram.com",
  followed: false,
  final_url: null,
  final_domain: null,
  title: null,
  text: null,
  content_hash: null,
  error: null,
};
const BROKEN: LinkedPage = {
  ...INSTAGRAM,
  url: "https://padnieta.example",
  followed: true,
  error: "HTTP 500",
};

function video(id: string, overrides: Partial<Video> = {}): Video {
  return {
    video_id: id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: `Film ${id}`,
    description: "Kod: KANAL50",
    channel: "Kanał Testowy",
    channel_id: "UC123",
    channel_url: "https://www.youtube.com/@KanalTestowy",
    published_at: "2026-08-12T10:10:55-07:00",
    duration_s: 754,
    view_count: 1000,
    category: "Education",
    keywords: ["ETF"],
    is_unlisted: false,
    paid_promotion: true,
    transcript: {
      language: "pl",
      is_generated: true,
      text: "Cześć",
      segments: [{ start: 1.5, text: "Cześć" }],
    },
    transcript_error: null,
    links: [BROKER_PAGE, INSTAGRAM, BROKEN],
    promo_codes: ["KANAL50"],
    text: `Film ${id}\n\nKod: KANAL50\n\nCześć`,
    content_hash: `hash-${id}`,
    ...overrides,
  };
}

const COLLECTION: YoutubeCollection = {
  query: "XTB kod",
  paid_only: true,
  videos: [
    video("AAAAAAAAAA1"),
    video("BBBBBBBBBB2", {
      paid_promotion: false,
      transcript: null,
      transcript_error: "TranscriptsDisabled",
      published_at: null,
      links: [BROKER_PAGE],
    }),
  ],
  failed: [{ video_id: "CCCCCCCCCC3", error: "HTTP 404" }],
};
const IDS = { sourceId: "source-1", jobId: "job-1" };
const SCRAPED_AT = new Date("2026-11-21T16:00:00Z");

describe("youtubeSearchSource", () => {
  it("buduje ten sam adres wyszukiwania co serwis ML", () => {
    expect(youtubeSearchSource("XTB kod", true)).toEqual({
      platform: "youtube",
      url: "https://www.youtube.com/results?search_query=XTB+kod&sp=EgOAAgE%3D",
      name: "YouTube: „XTB kod” (płatne promocje)",
    });
    expect(youtubeSearchSource("XTB", false).url).toBe(
      "https://www.youtube.com/results?search_query=XTB",
    );
  });
});

describe("youtubeMaterialRows", () => {
  const rows = youtubeMaterialRows(COLLECTION, IDS, SCRAPED_AT);

  it("zapisuje filmy i każdą pobraną stronę raz", () => {
    expect(rows.map((row) => [row.platform, row.url])).toEqual([
      ["youtube", "https://www.youtube.com/watch?v=AAAAAAAAAA1"],
      ["youtube", "https://www.youtube.com/watch?v=BBBBBBBBBB2"],
      ["web", "https://www.broker.example/pl/konto"],
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ sourceId: "source-1", jobId: "job-1", scrapedAt: SCRAPED_AT });
    }
  });

  it("przenosi dane filmu do kolumn i metadata", () => {
    const [first, second] = rows;
    expect(first).toMatchObject({
      title: "Film AAAAAAAAAA1",
      author: "Kanał Testowy",
      text: "Film AAAAAAAAAA1\n\nKod: KANAL50\n\nCześć",
      contentHash: "hash-AAAAAAAAAA1",
      language: "pl",
      publishedAt: new Date("2026-08-12T17:10:55Z"),
    });
    expect(first?.metadata).toMatchObject({
      kind: "youtube_video",
      query: "XTB kod",
      paid_promotion: true,
      promo_codes: ["KANAL50"],
      transcript: { language: "pl", segments: [{ start: 1.5, text: "Cześć" }] },
    });
    // Linki bez tekstu stron (te są osobnymi materiałami).
    const linkMeta = ({ url, domain, followed, final_url, final_domain, error }: LinkedPage) => ({
      url,
      domain,
      followed,
      final_url,
      final_domain,
      error,
    });
    expect(first?.metadata?.links).toEqual([BROKER_PAGE, INSTAGRAM, BROKEN].map(linkMeta));
    expect(second).toMatchObject({ language: null, publishedAt: null });
    expect(second?.metadata).toMatchObject({
      paid_promotion: false,
      transcript: null,
      transcript_error: "TranscriptsDisabled",
    });
  });

  it("strona z linku wie, w których filmach była", () => {
    expect(rows[2]).toMatchObject({
      title: "Broker — konto",
      text: "Otwórz rachunek.",
      contentHash: "hash-broker",
      author: null,
      metadata: {
        kind: "linked_page",
        link_url: BROKER_PAGE.url,
        domain: "broker.example",
        found_in: [
          "https://www.youtube.com/watch?v=AAAAAAAAAA1",
          "https://www.youtube.com/watch?v=BBBBBBBBBB2",
        ],
      },
    });
  });

  it("pusty wynik to brak wierszy", () => {
    expect(youtubeMaterialRows({ ...COLLECTION, videos: [] }, IDS, SCRAPED_AT)).toEqual([]);
  });
});
