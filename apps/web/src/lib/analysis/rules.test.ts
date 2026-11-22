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

  it("film YouTube dostaje w M2 regułę 7, a z klatkami także 8", () => {
    expect(requestedRuleIds("risk_disclosure")).not.toContain("7");
    expect(requestedRuleIds("risk_disclosure", { video: true })).toContain("7");
    expect(requestedRuleIds("risk_disclosure", { video: true })).not.toContain("8");
    expect(requestedRuleIds("risk_disclosure", { frames: true })).toContain("8");
    expect(requestedRuleIds("unauthorized_advisory", { video: true })).not.toContain("7");
  });

  it("strona WWW z HTML-em dostaje w M2 reguły 7 i 8", () => {
    const ids = requestedRuleIds("risk_disclosure", { page: true });
    expect(ids).toContain("7");
    expect(ids).toContain("8");
    expect(requestedRuleIds("unauthorized_advisory", { page: true })).not.toContain("8");
  });

  it("M3 nie dostaje reguł wizualnych", () => {
    expect(requestedRuleIds("unauthorized_advisory", { frames: true })).toEqual(
      requestedRuleIds("unauthorized_advisory"),
    );
  });
});
