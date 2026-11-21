import { describe, expect, it } from "vitest";
import {
  channelUrlOf,
  M1_CHANNEL_INTERVAL_MINUTES,
  M1_SEARCH_INTERVAL_MINUTES,
  m1SearchSourceRows,
  youtubeChannelSourceRow,
} from "./m1-sources";

describe("źródła M1", () => {
  it("frazy z marek: wszystkie filmy, harmonogram, unikalne adresy", () => {
    const rows = m1SearchSourceRows();
    expect(new Set(rows.map((r) => r.url)).size).toBe(rows.length);
    const xtb = rows.find((r) => r.name === "M1: „XTB kod”");
    expect(xtb).toMatchObject({
      platform: "youtube",
      intervalMinutes: M1_SEARCH_INTERVAL_MINUTES,
      config: { kind: "youtube_search", query: "XTB kod", paidOnly: false },
    });
    expect(xtb?.url).not.toContain("sp=");
  });

  it("kanał z metadanych filmu, znormalizowany", () => {
    expect(
      channelUrlOf({
        kind: "youtube_video",
        channel_url: "https://www.youtube.com/@Kanal.Testowy",
      }),
    ).toBe("https://www.youtube.com/@Kanal.Testowy");
    expect(
      channelUrlOf({
        kind: "youtube_video",
        channel_url: "https://m.youtube.com/channel/UC1234567890123456789012/videos",
      }),
    ).toBe("https://www.youtube.com/channel/UC1234567890123456789012");
    expect(channelUrlOf({ kind: "linked_page" })).toBeNull();
    expect(
      channelUrlOf({ kind: "youtube_video", channel_url: "https://evil.example/@x" }),
    ).toBeNull();
  });

  it("wiersz źródła kanału", () => {
    expect(youtubeChannelSourceRow("https://www.youtube.com/@Kanal", "Kanał")).toMatchObject({
      platform: "youtube",
      name: "M1 kanał: Kanał",
      intervalMinutes: M1_CHANNEL_INTERVAL_MINUTES,
      config: { kind: "youtube_channel", channelUrl: "https://www.youtube.com/@Kanal", limit: 15 },
    });
  });
});
