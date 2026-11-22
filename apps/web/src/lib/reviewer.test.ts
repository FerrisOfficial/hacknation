import { describe, expect, it } from "vitest";
import { DEFAULT_REVIEWER, reviewerFromEnv } from "./reviewer";

describe("reviewerFromEnv", () => {
  it("bez zmiennych zwraca domyślnego analityka", () => {
    expect(reviewerFromEnv({})).toEqual(DEFAULT_REVIEWER);
  });

  it("bierze imię, rolę i UUID z env", () => {
    expect(
      reviewerFromEnv({
        UI_USER_ID: " 3F2504E0-4F89-41D3-9A0C-0305E82C3301 ",
        UI_USER_NAME: " Marta Kowalska ",
        UI_USER_ROLE: "analityczka",
      }),
    ).toEqual({
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      name: "Marta Kowalska",
      role: "analityczka",
    });
  });

  it("pusta rola = bez roli, zły UUID i puste imię = wartości domyślne", () => {
    expect(reviewerFromEnv({ UI_USER_ID: "marta", UI_USER_NAME: "  ", UI_USER_ROLE: "" })).toEqual({
      id: DEFAULT_REVIEWER.id,
      name: DEFAULT_REVIEWER.name,
      role: null,
    });
  });
});
