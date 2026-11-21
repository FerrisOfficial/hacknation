import "server-only";
import { type AnalysisModule, type Db, eq, type Material, materials } from "@app/db";
import type { AnalysisResultInput, AnalyzeOutput } from "@/lib/analysis/contract";
import { buildAnalysisResult } from "@/lib/analysis/details";
import { ANALYSIS_MODULES } from "@/lib/analysis/modules";
import { requestedRuleIds } from "@/lib/analysis/rules";
import { analyzeMaterial } from "@/lib/ml";
import { lookupEntity } from "./entity";
import { saveAnalysisResults } from "./results";

export type AnalyzeOutcome = "analyzed" | "skipped" | "missing";

type ModuleOutputs = { module: AnalysisModule; output: AnalyzeOutput }[];

// Wyjście modelu per moduł (§2) → wiersze `analysis_results` z `details` w kształcie §3.
// `entity` (dane KNF) jest wspólne dla wszystkich modułów materiału, więc liczymy je raz.
export async function buildResults(
  material: Material,
  outputs: ModuleOutputs,
): Promise<AnalysisResultInput[]> {
  if (outputs.length === 0) return [];
  const entity = await lookupEntity(material);
  return outputs.map(({ module, output }) => buildAnalysisResult(module, output, material, entity));
}

// Analiza materiału przez moduły AI 1–3 (jedno wywołanie `POST /analyze` na moduł, §1) i zapis
// wyników. Bez `force` pomija materiał, którego treść nie zmieniła się od ostatniej analizy.
export async function runAnalysis(
  db: Db,
  materialId: string,
  options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<AnalyzeOutcome> {
  const [material] = await db.select().from(materials).where(eq(materials.id, materialId));
  if (!material) return "missing";
  if (!options.force && material.analyzedHash === material.contentHash) return "skipped";

  const outputs: ModuleOutputs = [];
  for (const module of ANALYSIS_MODULES) {
    const output = await analyzeMaterial(
      {
        material_id: material.id,
        module,
        text: material.text,
        rules: requestedRuleIds(module),
      },
      options.signal,
    );
    outputs.push({ module, output });
  }
  await saveAnalysisResults(db, material, await buildResults(material, outputs));
  return "analyzed";
}
