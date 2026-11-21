import { z } from "zod";
import { ANALYSIS_MODULES, type PLATFORMS } from "./modules";

// Kontrakt backend ↔ moduły AI. Używany w dwóch miejscach:
// 1. worker kolejki woła `POST /analyze` w serwisie ML (`analyzeMaterial` w `@/lib/ml`) i waliduje
//    odpowiedź tym schematem,
// 2. `PUT /api/materials/:id/analysis` przyjmuje wyniki wypchnięte z zewnątrz (skrypt, notebook).
//
// `details` jest otwarte — moduł zapisuje tam, co ma. Raporty i dashboard czytają z niego te klucze
// (wszystkie opcjonalne):
//   entity: { name, knf_id?, registered?, register_name?, domains? }  — firma inwestycyjna (M1, M2)
//                                                                        albo podmiot doradczy (M3)
//   advertiser: string             — reklamujący, jeśli inny niż `materials.author` (M1)
//   phrases: string[]              — frazy, które zadecydowały o wyniku (M1, M3)
//   missing_requirements: string[] — niespełnione wymogi informacji o ryzyku (M2)
//   explanation: string            — uzasadnienie modelu w 1–3 zdaniach

export const analysisResultInputSchema = z.object({
  module: z.enum(ANALYSIS_MODULES),
  score: z.number().min(0).max(1),
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

// Odpowiedź `POST /analyze` serwisu ML. Moduł, który nie dotyczy materiału, może nie zwrócić
// wyniku (np. M2 dla posta finfluencera) — wtedy zostaje poprzedni wynik albo żaden.
export const analyzeResponseSchema = z.object({ results: analysisResultsInputSchema });

// Żądanie `POST /analyze` (snake_case jak reszta API serwisu ML).
export type AnalyzeRequest = {
  material_id: string;
  url: string;
  platform: (typeof PLATFORMS)[number];
  title: string | null;
  author: string | null;
  text: string;
  language: string | null;
  published_at: string | null;
  metadata: Record<string, unknown>;
  modules: (typeof ANALYSIS_MODULES)[number][];
};

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
