import { describe, expect, it } from "vitest";
import { incidentUpdateSchema, predictInputSchema, youtubeCollectInputSchema } from "./schemas";

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

describe("incidentUpdateSchema", () => {
  it("przyjmuje status Odłożony z powodem", () => {
    expect(
      incidentUpdateSchema.parse({ status: "postponed", review_note: " dowód niepełny " }),
    ).toEqual({ status: "postponed", review_note: "dowód niepełny" });
  });

  it("brak, null albo pusty powód = bez powodu", () => {
    for (const body of [
      { status: "confirmed" },
      { status: "confirmed", review_note: null },
      { status: "confirmed", review_note: "  " },
    ]) {
      expect(incidentUpdateSchema.parse(body)).toEqual({ status: "confirmed", review_note: null });
    }
  });

  it("odrzuca nieznany status i za długi powód", () => {
    expect(incidentUpdateSchema.safeParse({ status: "archived" }).success).toBe(false);
    expect(
      incidentUpdateSchema.safeParse({ status: "dismissed", review_note: "x".repeat(501) }).success,
    ).toBe(false);
  });
});
