import "server-only";
import {
  type AnalysisResult,
  analysisResults,
  type Db,
  eq,
  incidentEvents,
  type Material,
  materials,
  sql,
} from "@app/db";
import type { AnalysisResultInput } from "@/lib/analysis/contract";
import { readIncidentDetails } from "@/lib/incidents/contract";
import { systemEvents } from "@/lib/incidents/history";
import { publishEvent } from "@/lib/realtime/publish";
import { getThresholdSettings } from "./thresholds";

type AnalyzedMaterial = Pick<Material, "id" | "title" | "url" | "author" | "contentHash">;

// Agregacja wyników modułów 1–3 dla materiału: upsert po (materiał, moduł) — ponowna analiza
// nadpisuje score/label/details, a status przeglądu analityka zostaje. Wynik, który właśnie
// przekroczył próg `alert` swojego modułu (nowy albo wcześniej poniżej), idzie do Socket.io jako
// `incident.high_risk` (docs/KONTRAKT.md §10). Oflagowanie, alert i zmiana score'u incydentu
// trafiają do historii (`incident_events`, autor = system).
export async function saveAnalysisResults(
  db: Db,
  material: AnalyzedMaterial,
  results: AnalysisResultInput[],
  // false = zapisz wyniki, ale zostaw materiał do ponownej analizy (część modułów zawiodła).
  options: { markAnalyzed?: boolean } = {},
): Promise<AnalysisResult[]> {
  const settings = await getThresholdSettings(db);
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
            .values(
              results.map(({ risk_score, ...result }) => ({
                ...result,
                riskScore: risk_score ?? null,
                materialId: material.id,
              })),
            )
            .onConflictDoUpdate({
              target: [analysisResults.materialId, analysisResults.module],
              set: {
                score: excludedScore,
                riskScore: excludedRiskScore,
                label: excludedLabel,
                details: excludedDetails,
                model: excludedModel,
                updatedAt: now,
              },
            })
            .returning();

    if (options.markAnalyzed ?? true) {
      await tx
        .update(materials)
        .set({ analyzedHash: material.contentHash, analyzedAt: now })
        .where(eq(materials.id, material.id));
    }

    for (const result of saved) {
      const { flag, alert } = settings[result.module];
      const before = previous.get(result.module);
      const events = systemEvents({ score: result.score, before, flag, alert });
      if (events.length > 0) {
        await tx
          .insert(incidentEvents)
          .values(
            events.map((event) => ({ resultId: result.id, ...event, actorId: null, at: now })),
          );
      }
      if (!events.some((event) => event.kind === "alert")) continue;
      // NOTIFY w transakcji wychodzi dopiero po COMMIT — przeglądarka nie dostanie alertu
      // o wyniku, którego nie ma w bazie.
      await publishEvent(tx, {
        type: "incident.high_risk",
        id: result.id,
        module: result.module,
        score: Math.round(result.score * 10_000) / 10_000,
        summary: readIncidentDetails(result.details).summary,
        url: material.url,
      });
    }
    return saved;
  });
}

const excludedScore = sql.raw(`excluded."score"`);
const excludedRiskScore = sql.raw(`excluded."risk_score"`);
const excludedLabel = sql.raw(`excluded."label"`);
const excludedDetails = sql.raw(`excluded."details"`);
const excludedModel = sql.raw(`excluded."model"`);
