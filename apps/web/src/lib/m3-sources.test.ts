import { describe, expect, it } from "vitest";
import { M3_SEARCH_INTERVAL_MINUTES, M3_SEARCH_QUERIES, m3SearchSourceRows } from "./m3-sources";

describe("źródła M3", () => {
  it("frazy shadow advisory: wszystkie filmy, harmonogram, unikalne adresy", () => {
    const rows = m3SearchSourceRows();
    expect(rows).toHaveLength(M3_SEARCH_QUERIES.length);
    expect(new Set(rows.map((r) => r.url)).size).toBe(rows.length);
    expect(rows[0]).toMatchObject({
      platform: "youtube",
      name: "M3: „sygnały tradingowe grupa VIP”",
      intervalMinutes: M3_SEARCH_INTERVAL_MINUTES,
      config: { kind: "youtube_search", paidOnly: false },
    });
    expect(rows[0]?.url).not.toContain("sp=");
  });
});
