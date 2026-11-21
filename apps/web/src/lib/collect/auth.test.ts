import { describe, expect, it } from "vitest";
import { collectorAccess } from "./auth";

describe("collectorAccess", () => {
  it("bez tokenu w env kolektor jest wyłączony", async () => {
    expect(await collectorAccess("Bearer cokolwiek", undefined)).toBe("disabled");
    expect(await collectorAccess("Bearer cokolwiek", "")).toBe("disabled");
  });

  it("wpuszcza tylko z poprawnym tokenem Bearer", async () => {
    expect(await collectorAccess("Bearer tajny-token", "tajny-token")).toBe("ok");
    expect(await collectorAccess("bearer tajny-token ", "tajny-token")).toBe("ok");
    expect(await collectorAccess("Bearer zly-token", "tajny-token")).toBe("unauthorized");
    expect(await collectorAccess("tajny-token", "tajny-token")).toBe("unauthorized");
    expect(await collectorAccess(null, "tajny-token")).toBe("unauthorized");
  });
});
