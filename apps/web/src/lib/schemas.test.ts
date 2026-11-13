import { describe, expect, it } from "vitest";
import { predictInputSchema } from "./schemas";

describe("predictInputSchema", () => {
  it("przycina białe znaki i przepuszcza poprawny tekst", () => {
    expect(predictInputSchema.parse({ text: "  działa  " })).toEqual({ text: "działa" });
  });

  it("odrzuca za krótki tekst", () => {
    const result = predictInputSchema.safeParse({ text: "ab" });
    expect(result.success).toBe(false);
  });
});
