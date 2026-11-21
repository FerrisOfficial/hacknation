import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { handler, readQuery } from "@/lib/api/http";
import { getThresholds } from "@/lib/pipeline/thresholds";
import { listIncidents } from "@/lib/queries/results";
import { resultsQuerySchema } from "@/lib/schemas";

// GET /api/incidents — agregator: jeden obiekt na materiał z wynikami modułów 1–3, maksymalnym
// score, poziomem ryzyka i listą modułów, w których przekroczył próg. Te same filtry co
// /api/results (materiał pasuje, jeśli pasuje którykolwiek jego wynik).
export const GET = handler("incidents", async (request) => {
  const db = getDb();
  const query = readQuery(request, resultsQuerySchema);
  const thresholds = await getThresholds(db);
  return NextResponse.json({ ...(await listIncidents(db, query, thresholds)), thresholds });
});
