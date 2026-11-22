import { describe, expect, it } from "vitest";
import { FRAME_RULE_IDS, requestedRuleIds } from "./rules";

describe("requestedRuleIds", () => {
  it("bez klatek M2 nie dostaje reguł 4, 5, 6", () => {
    const ids = requestedRuleIds("risk_disclosure");
    for (const id of ["4", "5", "6"]) expect(ids).not.toContain(id);
  });

  it("z klatkami M2 dostaje reguły wizualne, bez duplikatów", () => {
    const ids = requestedRuleIds("risk_disclosure", { frames: true });
    for (const id of FRAME_RULE_IDS) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("M3 nie dostaje reguł wizualnych", () => {
    expect(requestedRuleIds("unauthorized_advisory", { frames: true })).toEqual(
      requestedRuleIds("unauthorized_advisory"),
    );
  });
});
