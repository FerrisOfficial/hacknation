import type { AnalysisModule, Material } from "@app/db";
import type { Flag, IncidentDetails, IncidentEntity } from "@/lib/incidents/contract";
import type { AnalysisResultInput, AnalyzeOutput } from "./contract";
import { buildEvidence } from "./evidence";
import { findRule } from "./rules";

// Wyjście modelu (docs/KONTRAKT.md §2) → wiersz `analysis_results` z `details` w kształcie §3.
// Czysta funkcja: dane KNF (`entity`) przychodzą z zewnątrz.

export type DetailsMaterial = Pick<Material, "url" | "platform" | "text" | "metadata">;

// Etykieta modelu, która oznacza naruszenie (M1 i M3). W M2 model nie zwraca etykiety.
const POSITIVE_LABEL: Partial<Record<AnalysisModule, string>> = {
  finfluencer: "reklama",
  unauthorized_advisory: "potencjalne_doradztwo",
};

// Reguła `suggestion` (wizualna, ocenna) waży w score połowę reguły `hard`.
const SUGGESTION_WEIGHT = 0.5;

export const DEFAULT_MODEL_NAME = "services/ml";

export function buildFlags(
  module: AnalysisModule,
  output: Pick<AnalyzeOutput, "findings">,
  material: DetailsMaterial,
): Flag[] {
  const seen = new Set<string>();
  return output.findings.flatMap((finding) => {
    const rule = findRule(module, finding.rule_id);
    // Reguły spoza katalogu modułu (halucynacja modelu) i duplikaty pomijamy.
    if (!rule || seen.has(rule.id)) return [];
    seen.add(rule.id);
    return [
      {
        rule_id: rule.id,
        rule_name: rule.name,
        legal_basis: rule.legalBasis,
        kind: rule.kind,
        result: finding.result,
        confidence: round(finding.confidence),
        reason: finding.reason,
        evidence: buildEvidence(material, finding.quote),
      },
    ];
  });
}

// Score 0–1 = prawdopodobieństwo naruszenia, z nim porównujemy progi `flag` i `alert`.
// M1, M3: `probability` etykiety modelu (dla etykiety negatywnej 1 − probability).
// M2 (i M1/M3 bez `probability`): noisy-OR pewności naruszonych reguł — każde kolejne naruszenie
// podnosi score, reguły `suggestion` z wagą 0,5.
export function computeScore(
  module: AnalysisModule,
  output: Pick<AnalyzeOutput, "label" | "probability" | "error">,
  flags: readonly Flag[],
): number {
  if (output.error) return 0;
  const positive = POSITIVE_LABEL[module];
  if (positive && output.label !== null && output.probability !== null) {
    return round(output.label === positive ? output.probability : 1 - output.probability);
  }
  const clean = flags
    .filter((flag) => flag.result === "violation")
    .reduce(
      (acc, flag) =>
        acc * (1 - flag.confidence * (flag.kind === "suggestion" ? SUGGESTION_WEIGHT : 1)),
      1,
    );
  return round(1 - clean);
}

// `label` w `analysis_results` (i na liście incydentów, §4): w M1/M3 etykieta modelu,
// w M2 „naruszenie” albo „brak_naruszen”.
export function resultLabel(
  output: Pick<AnalyzeOutput, "label" | "error">,
  flags: readonly Flag[],
): string {
  if (output.error) return "blad_analizy";
  if (output.label) return output.label;
  return flags.some((flag) => flag.result === "violation") ? "naruszenie" : "brak_naruszen";
}

export function buildAnalysisResult(
  module: AnalysisModule,
  output: AnalyzeOutput,
  material: DetailsMaterial,
  entity: IncidentEntity,
): AnalysisResultInput {
  // Przy błędzie modelu kontrakt każe zwrócić puste `findings` — nie ufamy częściowym wynikom.
  const flags = output.error ? [] : buildFlags(module, output, material);
  const details: IncidentDetails = {
    summary: output.summary.trim(),
    entity,
    flags,
    error: output.error,
  };
  return {
    module,
    score: computeScore(module, output, flags),
    label: resultLabel(output, flags).slice(0, 100),
    model: output.model ?? DEFAULT_MODEL_NAME,
    details,
  };
}

function round(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
}
