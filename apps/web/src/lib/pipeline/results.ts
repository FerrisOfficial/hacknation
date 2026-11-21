import "server-only";
import {
  type AnalysisResult,
  analysisResults,
  type Db,
  eq,
  type Material,
  materials,
  sql,
} from "@app/db";
import type { AnalysisResultInput } from "@/lib/analysis/contract";
import { riskLevel } from "@/lib/analysis/modules";
import { publishEvent } from "@/lib/realtime/publish";
import { getThresholds } from "./thresholds";

type AnalyzedMaterial = Pick<Material, "id" | "title" | "url" | "author" | "contentHash">;

// Agregacja wyników modułów 1–3 dla materiału: upsert po (materiał, moduł) — ponowna analiza
// nadpisuje score/label/details, a status przeglądu analityka zostaje. Wynik, który właśnie
// przekroczył próg swojego modułu (nowy albo wcześniej poniżej), idzie jako alert do Socket.io.
export async function saveAnalysisResults(
  db: Db,
  material: AnalyzedMaterial,
  results: AnalysisResultInput[],
): Promise<AnalysisResult[]> {
  const thresholds = await getThresholds(db);
  const now = new Date();
  return db.transaction(async (tx) => {
    const previous = new Map(
      (
        await tx
          .select({ module: analysisResults.module, score: analysisResults.score })
          .from(analysisResults)
          .where(eq(analysisResults.materialId, material.id))
      ).map((row) => [row.module, row.score]),
    );

    const saved =
      results.length === 0
        ? []
        : await tx
            .insert(analysisResults)
            .values(results.map((result) => ({ ...result, materialId: material.id })))
            .onConflictDoUpdate({
              target: [analysisResults.materialId, analysisResults.module],
              set: {
                score: excludedScore,
                label: excludedLabel,
                details: excludedDetails,
                model: excludedModel,
                updatedAt: now,
              },
            })
            .returning();

    await tx
      .update(materials)
      .set({ analyzedHash: material.contentHash, analyzedAt: now })
      .where(eq(materials.id, material.id));

    for (const result of saved) {
      const threshold = thresholds[result.module];
      const level = riskLevel(result.score, threshold);
      const before = previous.get(result.module);
      if (level === "low" || (before !== undefined && before >= threshold)) continue;
      // NOTIFY w transakcji wychodzi dopiero po COMMIT — przeglądarka nie dostanie alertu
      // o wyniku, którego nie ma w bazie.
      await publishEvent(tx, {
        type: "alert",
        resultId: result.id,
        materialId: material.id,
        module: result.module,
        score: result.score,
        threshold,
        riskLevel: level,
        label: result.label,
        title: material.title,
        url: material.url,
        author: material.author,
        detectedAt: result.updatedAt.toISOString(),
      });
    }
    return saved;
  });
}

const excludedScore = sql.raw(`excluded."score"`);
const excludedLabel = sql.raw(`excluded."label"`);
const excludedDetails = sql.raw(`excluded."details"`);
const excludedModel = sql.raw(`excluded."model"`);
