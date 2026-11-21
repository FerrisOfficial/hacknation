import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { HttpError, handler, readQuery } from "@/lib/api/http";
import type { Trend } from "@/lib/incidents/contract";
import { getThresholds } from "@/lib/pipeline/thresholds";
import { incidentTrend } from "@/lib/queries/stats";
import { statsTrendQuerySchema } from "@/lib/schemas";

// GET /api/stats/trend?from=&to= — docs/KONTRAKT.md §7: liczba incydentów (score ≥ próg `flag`
// modułu) na dzień kalendarzowy (Europe/Warsaw), per moduł. Dni bez incydentów mają zera.
// Bez `from` — ostatnie 30 dni.
export const GET = handler("stats/trend", async (request) => {
  const { from, to } = readQuery(request, statsTrendQuerySchema);
  const db = getDb();
  try {
    const trend = await incidentTrend(
      db,
      { bucket: "day", scope: "flagged", from, to },
      await getThresholds(db),
    );
    const body: Trend = {
      points: trend.points.map((point) => ({
        date: point.bucket,
        finfluencer: point.finfluencer,
        risk_disclosure: point.risk_disclosure,
        unauthorized_advisory: point.unauthorized_advisory,
      })),
    };
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof RangeError) throw new HttpError(400, error.message);
    throw error;
  }
});
