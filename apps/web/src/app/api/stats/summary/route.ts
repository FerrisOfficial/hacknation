import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { handler } from "@/lib/api/http";
import { getThresholds } from "@/lib/pipeline/thresholds";
import { summary } from "@/lib/queries/stats";

// GET /api/stats/summary — kafelki dashboardu: źródła, materiały (per platforma), wyniki per moduł
// (flagowane, poziomy ryzyka, statusy przeglądu) i zadania scrapingu z ostatnich 24 h.
export const GET = handler("stats/summary", async () => {
  const db = getDb();
  return NextResponse.json(await summary(db, await getThresholds(db)));
});
