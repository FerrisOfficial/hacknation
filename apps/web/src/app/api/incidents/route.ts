import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { handler, readQuery } from "@/lib/api/http";
import { getThresholds } from "@/lib/pipeline/thresholds";
import { listIncidentItems } from "@/lib/queries/incidents";
import { incidentsQuerySchema } from "@/lib/schemas";

// GET /api/incidents — docs/KONTRAKT.md §4. Incydent = wynik modułu ze score ≥ próg `flag`
// modułu, najnowsze pierwsze. Parametry: module, from, to, platform, min_score, status, page
// (module/platform/status także jako listy po przecinku), opcjonalnie page_size (domyślnie 25).
export const GET = handler("incidents", async (request) => {
  const db = getDb();
  const query = readQuery(request, incidentsQuerySchema);
  return NextResponse.json(await listIncidentItems(db, query, await getThresholds(db)));
});
