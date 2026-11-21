import { describe, expect, it } from "vitest";
import { predictInputSchema, youtubeCollectInputSchema } from "./schemas";

describe("predictInputSchema", () => {
  it("przycina białe znaki i przepuszcza poprawny tekst", () => {
    expect(predictInputSchema.parse({ text: "  działa  " })).toEqual({ text: "działa" });
  });

  it("odrzuca za krótki tekst", () => {
    const result = predictInputSchema.safeParse({ text: "ab" });
    expect(result.success).toBe(false);
  });
});

describe("youtubeCollectInputSchema", () => {
  it("uzupełnia domyślne: 10 filmów, tylko płatne promocje", () => {
    expect(youtubeCollectInputSchema.parse({ query: " XTB kod " })).toEqual({
      query: "XTB kod",
      limit: 10,
      paidOnly: true,
    });
  });

  it("odrzuca pustą frazę i limit spoza 1–50", () => {
    for (const body of [{ query: " " }, { query: "XTB", limit: 0 }, { query: "XTB", limit: 51 }]) {
      expect(youtubeCollectInputSchema.safeParse(body).success).toBe(false);
    }
  });
});
