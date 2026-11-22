import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { type IncidentEntity, readIncidentDetails } from "@/lib/incidents/contract";
import { type AnalyzeOutput, analyzeOutputSchema } from "./contract";
import { buildAnalysisResult } from "./details";
import { RULES, requestedRuleIds } from "./rules";

const MATERIAL = {
  url: "https://broker.example/oferta",
  platform: "web" as const,
  text: "Zarabiaj nawet 20% rocznie! Nadzoruje nas KNF, więc to bezpieczne.",
  metadata: {},
};

const ENTITY: IncidentEntity = {
  firm_name: "Broker Przykładowy S.A.",
  knf_id: 1001,
  in_register: true,
  advertiser: null,
  nip: null,
  domain: "broker.example",
  on_warning_list: false,
};

// Wejście jak z sieci (findings: unknown[]) — także niepoprawne pozycje.
function output(overrides: Partial<z.input<typeof analyzeOutputSchema>>): AnalyzeOutput {
  return analyzeOutputSchema.parse({
    material_id: "m1",
    label: null,
    probability: null,
    summary: "Reklama bez informacji o ryzyku.",
    findings: [],
    error: null,
    ...overrides,
  });
}

describe("katalog reguł", () => {
  it("M2: 19 pozycji z kryteriów UKNF (12a i 12b osobno), unikalne id", () => {
    const m2 = RULES.filter((r) => r.module === "risk_disclosure");
    expect(m2).toHaveLength(19);
    expect(new Set(RULES.map((r) => `${r.module}:${r.id}`)).size).toBe(RULES.length);
  });

  it("wejście modelu: M1 jedna reguła, M3 werdykt i przesłanki bez rejestru, M2 bez wizualnych", () => {
    expect(requestedRuleIds("finfluencer")).toEqual(["M1.ad"]);
    expect(requestedRuleIds("unauthorized_advisory")).toEqual([
      "M3.advisory",
      "M3.offer",
      "M3.recommendation",
      "M3.personal",
      "M3.paid",
      "M3.claims",
      "M3.disclaimer",
    ]);
    expect(requestedRuleIds("risk_disclosure")).toContain("3");
    expect(requestedRuleIds("risk_disclosure")).not.toContain("4");
  });
});

describe("buildAnalysisResult", () => {
  it("M2 bez rule_scores (stara odpowiedź): flagi z katalogu, dowód, score noisy-OR", () => {
    const result = buildAnalysisResult(
      "risk_disclosure",
      output({
        findings: [
          {
            rule_id: "3",
            result: "violation",
            confidence: 0.8,
            quote: "nawet 20% rocznie",
            reason: "Brak ryzyka.",
          },
          {
            rule_id: 18,
            result: "violation",
            confidence: 0.5,
            quote: "parafraza",
            reason: "KNF jako gwarancja.",
          },
          { rule_id: "1", result: "ok", confidence: 0.9, quote: null, reason: "" },
          {
            rule_id: "99",
            result: "violation",
            confidence: 1,
            quote: null,
            reason: "spoza katalogu",
          },
          { rule_id: "3", result: "ok", confidence: 0.1, quote: null, reason: "duplikat" },
          { rule_id: "2", result: "zle", confidence: 2 },
        ],
      }),
      MATERIAL,
      ENTITY,
    );
    expect(result.score).toBe(0.9);
    expect(result.label).toBe("naruszenie");
    expect(result.model).toBe("services/ml");
    expect(result.details).toEqual({
      summary: "Reklama bez informacji o ryzyku.",
      entity: ENTITY,
      flags: [
        {
          rule_id: "3",
          rule_name: "Informacja o ryzyku",
          legal_basis: "art. 44 ust. 2 lit. b rozporządzenia del. 2017/565",
          kind: "hard",
          result: "violation",
          confidence: 0.8,
          score: null,
          reason: "Brak ryzyka.",
          evidence: {
            quote: "nawet 20% rocznie",
            start: 9,
            end: 26,
            timestamp_s: null,
            link: "https://broker.example/oferta#:~:text=nawet%2020%25%20rocznie",
          },
        },
        expect.objectContaining({ rule_id: "18", evidence: null }),
        expect.objectContaining({ rule_id: "1", result: "ok", evidence: null }),
      ],
      error: null,
    });
  });

  it("M2 bez naruszeń: score 0, „brak_naruszen”; reguła suggestion waży połowę", () => {
    const clean = buildAnalysisResult("risk_disclosure", output({}), MATERIAL, ENTITY);
    expect(clean.score).toBe(0);
    expect(clean.label).toBe("brak_naruszen");
    const suggestion = buildAnalysisResult(
      "risk_disclosure",
      output({
        findings: [{ rule_id: "9", result: "violation", confidence: 0.8, quote: null, reason: "" }],
      }),
      MATERIAL,
      ENTITY,
    );
    expect(suggestion.score).toBe(0.4);
  });

  it("M1/M3: score z probability etykiety modelu", () => {
    const ad = buildAnalysisResult(
      "finfluencer",
      output({ label: "reklama", probability: 0.74 }),
      MATERIAL,
      ENTITY,
    );
    expect(ad).toMatchObject({ score: 0.74, label: "reklama" });
    const mention = buildAnalysisResult(
      "finfluencer",
      output({ label: "wzmianka", probability: 0.9 }),
      MATERIAL,
      ENTITY,
    );
    expect(mention.score).toBe(0.1);
    const advisory = buildAnalysisResult(
      "unauthorized_advisory",
      output({ label: "potencjalne_doradztwo", probability: 0.66, model: "gemma4:e2b" }),
      MATERIAL,
      { ...ENTITY, in_register: false, knf_id: null },
    );
    expect(advisory).toMatchObject({ score: 0.66, model: "gemma4:e2b" });
  });

  it("błąd modelu: score 0, bez flag, error w details", () => {
    const result = buildAnalysisResult(
      "risk_disclosure",
      output({
        error: "timeout",
        findings: [{ rule_id: "3", result: "violation", confidence: 1, quote: null, reason: "" }],
      }),
      MATERIAL,
      ENTITY,
    );
    expect(result).toMatchObject({ score: 0, label: "blad_analizy" });
    expect(result.details).toMatchObject({ flags: [], error: "timeout" });
  });

  it("M2 z rule_scores: score = najwyższy score reguły (próg na regułach), risk_score do sortowania", () => {
    const result = buildAnalysisResult(
      "risk_disclosure",
      output({
        findings: [
          {
            rule_id: "3",
            result: "violation",
            confidence: 0.53,
            quote: "nawet 20% rocznie",
            reason: "",
          },
          { rule_id: "2", result: "violation", confidence: 0.55, quote: null, reason: "" },
        ],
        rule_scores: {
          "3": { p_violation: 0.53, weight: 1, score: 0.53 },
          "2": { p_violation: 0.55, weight: 0.3, score: 0.165 },
          "99": { p_violation: 1, weight: 1, score: 1 },
          "16": { score: 7 },
        },
        risk_score: 0.6,
      }),
      MATERIAL,
      ENTITY,
    );
    // Noisy-OR dawałby 1 − 0,47 · 0,45 ≈ 0,79; teraz liczy się najwyższa reguła z katalogu.
    expect(result.score).toBe(0.53);
    expect(result.risk_score).toBe(0.6);
    expect(readIncidentDetails(result.details).flags.map((f) => [f.rule_id, f.score])).toEqual([
      ["3", 0.53],
      ["2", 0.165],
    ]);
  });

  it("M2: sama reguła formalna (2) nie robi incydentu przy progu 0,5", () => {
    const result = buildAnalysisResult(
      "risk_disclosure",
      output({
        findings: [{ rule_id: "2", result: "violation", confidence: 0.55, quote: null }],
        rule_scores: { "2": { score: 0.165 }, "3": { score: 0.1 } },
        risk_score: 0.2,
      }),
      MATERIAL,
      ENTITY,
    );
    expect(result.score).toBe(0.165);
    expect(result.score).toBeLessThan(0.5);
  });

  it("M2: błąd modelu daje score i risk_score 0", () => {
    const result = buildAnalysisResult(
      "risk_disclosure",
      output({ error: "timeout", rule_scores: { "3": { score: 0.9 } }, risk_score: 0.9 }),
      MATERIAL,
      ENTITY,
    );
    expect(result.score).toBe(0);
    expect(result.risk_score).toBe(0);
  });

  it("bez risk_score z ML: risk_score = score", () => {
    const result = buildAnalysisResult(
      "risk_disclosure",
      output({ rule_scores: { "3": { score: 0.7 } } }),
      MATERIAL,
      ENTITY,
    );
    expect(result.risk_score).toBe(0.7);
  });
});
