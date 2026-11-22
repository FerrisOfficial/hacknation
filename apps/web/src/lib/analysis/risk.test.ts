import { describe, expect, it } from "vitest";
import type { Flag } from "@/lib/incidents/contract";
import { riskScore } from "./risk";

const FLAG: Flag = {
  rule_id: "3",
  rule_name: "",
  legal_basis: "",
  kind: "hard",
  result: "violation",
  confidence: 0,
  score: null,
  reason: "",
  evidence: null,
};

const v = (score: number | null): Flag => ({ ...FLAG, score });

describe("riskScore", () => {
  it("jedno naruszenie: risk = jego score", () => {
    expect(riskScore([v(0.91)], 0.5, 0)).toBe(0.91);
  });

  it("więcej wysokich naruszeń → wyżej, nigdy poniżej najwyższego", () => {
    const one = riskScore([v(0.9)], 0.5, 0);
    const three = riskScore([v(0.9), v(0.8), v(0.7)], 0.5, 0);
    // 1 − 0,1 · 0,6 · 0,825
    expect(three).toBeCloseTo(1 - 0.1 * 0.6 * 0.825, 4);
    expect(three).toBeGreaterThan(one);
  });

  it("naruszenia poniżej progu nie wpływają na wynik", () => {
    const withNoise = riskScore([v(0.9), ...Array.from({ length: 10 }, () => v(0.3))], 0.5, 0);
    expect(withNoise).toBe(0.9);
    // Niższy suwak — te same naruszenia już się liczą.
    expect(riskScore([v(0.9), v(0.3)], 0.2, 0)).toBeGreaterThan(0.9);
  });

  it("liczy się score reguły względem progu, nie etykieta modelu", () => {
    // Model nazwał regułę „ok” (P < 0,5), ale suwak na 0,3 — reguła przekracza próg i się liczy.
    const okLabel: Flag = { ...FLAG, result: "ok", score: 0.41 };
    expect(riskScore([okLabel], 0.3, 0.41)).toBe(0.41);
  });

  it("bez score'ów reguł (M1, M3, starsze wyniki): score wyniku", () => {
    expect(riskScore([v(null), FLAG], 0.5, 0.66)).toBe(0.66);
    expect(riskScore([], 0.5, 0.4)).toBe(0.4);
  });

  it("żadne naruszenie nie przekracza progu: 0", () => {
    expect(riskScore([v(0.3), v(0.2)], 0.5, 0.3)).toBe(0);
  });
});
