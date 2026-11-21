import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { metricsAt } from "@/lib/analysis/calibration";
import { handler, readQuery } from "@/lib/api/http";
import type { Calibration } from "@/lib/incidents/contract";
import { getThresholds } from "@/lib/pipeline/thresholds";
import { scoreHistogram } from "@/lib/queries/stats";
import { calibrationQuerySchema } from "@/lib/schemas";

// GET /api/calibration?module=&threshold= — docs/KONTRAKT.md §9: podgląd progu bez zapisu.
// Prawda bazowa = decyzje analityków: confirmed = naruszenie, dismissed = brak naruszenia.
// `flagged` liczy wszystkie wyniki ze score ≥ próg (także nieoznaczone) — tyle incydentów
// zobaczy analityk. Bez `threshold` — zapisany próg `flag` modułu.
export const GET = handler("calibration", async (request) => {
  const { module, threshold } = readQuery(request, calibrationQuerySchema);
  const db = getDb();
  const [histogram, thresholds] = await Promise.all([
    scoreHistogram(db, module),
    threshold === undefined ? getThresholds(db) : null,
  ]);
  const value = threshold ?? thresholds?.[module] ?? 0;
  const metrics = metricsAt(histogram, value);
  const body: Calibration = {
    module,
    threshold: value,
    flagged: metrics.flagged,
    labeled: histogram.reduce((sum, row) => sum + row.positive + row.negative, 0),
    tp: metrics.truePositive,
    fp: metrics.falsePositive,
    fn: metrics.falseNegative,
    tn: metrics.trueNegative,
    precision: metrics.precision,
    recall: metrics.recall,
  };
  return NextResponse.json(body);
});
