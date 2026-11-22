import { z } from "zod";
import { ANALYSIS_MODULES } from "./modules";

// Wynik modułu AI zapisywany w `analysis_results` (`saveAnalysisResults`). `details` w kształcie
// z docs/KONTRAKT.md §3 buduje `buildAnalysisResult` (`@/lib/analysis/details`) z wyjścia modelu.
// `PUT /api/materials/:id/analysis` przyjmuje też gotowe wyniki w tym kształcie (skrypt, notebook).
// Stary kształt `details` (`entity.name`, `phrases`, `missing_requirements`, `explanation`)
// nadal czytają `readDetails` niżej i `readIncidentDetails`.

export const analysisResultInputSchema = z.object({
  module: z.enum(ANALYSIS_MODULES),
  // Do progu: incydent, gdy score ≥ próg `flag` modułu (M2: najwyższy score reguły).
  score: z.number().min(0).max(1),
  // Do sortowania listy incydentów (M2: `risk_score` z ML). Brak = sortujemy po `score`.
  risk_score: z.number().min(0).max(1).nullable().optional(),
  label: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
  details: z.record(z.string(), z.unknown()).default({}),
});

export type AnalysisResultInput = z.infer<typeof analysisResultInputSchema>;

export const analysisResultsInputSchema = z
  .array(analysisResultInputSchema)
  .max(ANALYSIS_MODULES.length)
  .refine((results) => new Set(results.map((r) => r.module)).size === results.length, {
    message: "Każdy moduł może wystąpić najwyżej raz",
  });

// ─── Model AI: `POST /analyze` w serwisie ML (docs/KONTRAKT.md §1, §2) ──────────────────────
// Jedno wywołanie = jeden materiał i jeden moduł. Model ocenia reguły i zwraca cytat, a backend
// (`@/lib/analysis/details`) dokłada katalog reguł, pozycje cytatu, link, dane KNF i score.

// §1: wejście modelu. `rules` z katalogu (`requestedRuleIds` w `@/lib/analysis/rules`).
export type AnalyzeRequest = {
  material_id: string;
  module: (typeof ANALYSIS_MODULES)[number];
  text: string;
  rules: string[];
};

export const FINDING_RESULTS = ["violation", "ok", "n/a"] as const;

const probability = z.number().min(0).max(1);

export const findingSchema = z.object({
  rule_id: z.coerce.string().trim().min(1),
  result: z.enum(FINDING_RESULTS),
  confidence: probability,
  quote: z.string().nullable().default(null),
  reason: z.string().default(""),
});

export type Finding = z.infer<typeof findingSchema>;

const ruleScoreSchema = z.object({ score: probability });

// §2: wyjście modelu. Pojedyncza zła pozycja w `findings` nie unieważnia całej odpowiedzi —
// odrzucamy tylko ją. `model` (nazwa modelu) jest poza kontraktem i opcjonalne.
export const analyzeOutputSchema = z.object({
  material_id: z.string(),
  label: z.string().trim().min(1).nullable().default(null),
  probability: probability.nullable().default(null),
  summary: z.string().default(""),
  findings: z
    .array(z.unknown())
    .default([])
    .transform((items) =>
      items.flatMap((item) => {
        const finding = findingSchema.safeParse(item);
        return finding.success ? [finding.data] : [];
      }),
    ),
  error: z.string().nullable().default(null),
  model: z.string().trim().min(1).max(200).optional(),
  // Poza §2, tylko M2: score każdej reguły (waga * P(naruszenie)) i score do sortowania.
  // Zła pozycja `rule_scores` nie unieważnia odpowiedzi — pomijamy ją.
  rule_scores: z
    .record(z.string(), z.unknown())
    .default({})
    .catch({})
    .transform((items) =>
      Object.fromEntries(
        Object.entries(items).flatMap(([ruleId, item]) => {
          const parsed = ruleScoreSchema.safeParse(item);
          return parsed.success ? [[ruleId, parsed.data.score]] : [];
        }),
      ),
    ),
  risk_score: probability.nullable().default(null).catch(null),
});

export type AnalyzeOutput = z.infer<typeof analyzeOutputSchema>;

// Wyjście modelu wypchnięte z zewnątrz (PUT /api/materials/:id/analysis): §2 + moduł.
export const moduleOutputSchema = analyzeOutputSchema.extend({
  module: z.enum(ANALYSIS_MODULES),
  material_id: z.string().optional(),
});

export type ModuleOutput = z.infer<typeof moduleOutputSchema>;

// Odczyt kluczy z `details` do raportów — bez zaufania do kształtu (pisze je model).
const entitySchema = z
  .object({
    name: z.string().optional(),
    knf_id: z.union([z.string(), z.number()]).optional(),
    registered: z.boolean().optional(),
    register_name: z.string().optional(),
    domains: z.array(z.string()).optional(),
  })
  .partial();

export const resultDetailsSchema = z.object({
  entity: entitySchema.optional().catch(undefined),
  advertiser: z.string().optional().catch(undefined),
  phrases: z.array(z.string()).optional().catch(undefined),
  missing_requirements: z.array(z.string()).optional().catch(undefined),
  explanation: z.string().optional().catch(undefined),
});

export type ResultDetails = z.infer<typeof resultDetailsSchema>;

export function readDetails(details: Record<string, unknown>): ResultDetails {
  const parsed = resultDetailsSchema.safeParse(details);
  return parsed.success ? parsed.data : {};
}
