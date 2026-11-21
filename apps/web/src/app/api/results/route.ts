import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { handler, readQuery } from "@/lib/api/http";
import { getThresholds } from "@/lib/pipeline/thresholds";
import { listResults } from "@/lib/queries/results";
import { resultsQuerySchema } from "@/lib/schemas";

// GET /api/results — wyniki modułów AI (jeden wiersz = materiał × moduł).
// Filtry: module, status, risk (low|medium|high), platform (listy po przecinku), sourceId,
// from/to (data wykrycia), q (tytuł/URL/autor/treść), minScore, sort=date|score, page, pageSize.
// risk=medium,high = tylko flagowane (score ≥ próg modułu).
export const GET = handler("results", async (request) => {
  const db = getDb();
  const query = readQuery(request, resultsQuerySchema);
  const thresholds = await getThresholds(db);
  return NextResponse.json({ ...(await listResults(db, query, thresholds)), thresholds });
});
