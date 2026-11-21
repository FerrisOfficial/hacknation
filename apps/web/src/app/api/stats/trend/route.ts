import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { HttpError, handler, readQuery } from "@/lib/api/http";
import { getThresholds } from "@/lib/pipeline/thresholds";
import { incidentTrend } from "@/lib/queries/stats";
import { trendQuerySchema } from "@/lib/schemas";

// GET /api/stats/trend?bucket=day&from=&to=&module=&platform=&scope=flagged|high|all
// Liczba wykrytych incydentów w czasie, per moduł — gotowe pod Recharts:
// points: [{ bucket: "2026-11-21", finfluencer, risk_disclosure, unauthorized_advisory, total }].
export const GET = handler("stats/trend", async (request) => {
  const query = readQuery(request, trendQuerySchema);
  const db = getDb();
  try {
    return NextResponse.json(await incidentTrend(db, query, await getThresholds(db)));
  } catch (error) {
    if (error instanceof RangeError) throw new HttpError(400, error.message);
    throw error;
  }
});
