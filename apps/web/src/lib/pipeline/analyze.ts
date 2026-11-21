import "server-only";
import { type Db, eq, materials } from "@app/db";
import { ANALYSIS_MODULES } from "@/lib/analysis/modules";
import { analyzeMaterial } from "@/lib/ml";
import { saveAnalysisResults } from "./results";

export type AnalyzeOutcome = "analyzed" | "skipped" | "missing";

// Analiza materiału przez moduły AI w serwisie ML i zapis wyników (agregacja per moduł).
// Bez `force` pomija materiał, którego treść nie zmieniła się od ostatniej analizy.
export async function runAnalysis(
  db: Db,
  materialId: string,
  options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<AnalyzeOutcome> {
  const [material] = await db.select().from(materials).where(eq(materials.id, materialId));
  if (!material) return "missing";
  if (!options.force && material.analyzedHash === material.contentHash) return "skipped";

  const results = await analyzeMaterial(
    {
      material_id: material.id,
      url: material.url,
      platform: material.platform,
      title: material.title,
      author: material.author,
      text: material.text,
      language: material.language,
      published_at: material.publishedAt?.toISOString() ?? null,
      metadata: material.metadata,
      modules: [...ANALYSIS_MODULES],
    },
    options.signal,
  );
  await saveAnalysisResults(db, material, results);
  return "analyzed";
}
