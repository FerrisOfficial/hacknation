import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { calibrationCurve, metricsAt, recommendedThreshold } from "@/lib/analysis/calibration";
import { handler, readQuery } from "@/lib/api/http";
import { getThresholds } from "@/lib/pipeline/thresholds";
import { scoreHistogram } from "@/lib/queries/stats";
import { calibrationQuerySchema } from "@/lib/schemas";

// GET /api/calibration?module=&threshold= — panel kalibracji: dla progu (podgląd, bez zapisu)
// macierz pomyłek TP/FP/FN/TN, precision, recall, F1 i liczba alertów, plus krzywa dla progów
// co 0,05 i rekomendowany próg (max F1). Prawda bazowa = decyzje analityków (confirmed/dismissed).
export const GET = handler("calibration", async (request) => {
  const { module, threshold } = readQuery(request, calibrationQuerySchema);
  const db = getDb();
  const [histogram, thresholds] = await Promise.all([
    scoreHistogram(db, module),
    getThresholds(db),
  ]);
  const saved = thresholds[module];
  const curve = calibrationCurve(histogram);
  const labeled = histogram.reduce((sum, row) => sum + row.positive + row.negative, 0);
  return NextResponse.json({
    module,
    savedThreshold: saved,
    threshold: threshold ?? saved,
    metrics: metricsAt(histogram, threshold ?? saved),
    curve,
    recommendedThreshold: recommendedThreshold(curve),
    labeled,
    unlabeled: histogram.reduce((sum, row) => sum + row.unlabeled, 0),
    // Rozkład score (np. histogram na wykresie) — koszyki co 0,01.
    histogram,
  });
});
