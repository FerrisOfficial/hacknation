import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { handler, readBody } from "@/lib/api/http";
import { getThresholds, setThreshold } from "@/lib/pipeline/thresholds";
import { publishEventSafe } from "@/lib/realtime/publish";
import { thresholdUpdateSchema } from "@/lib/schemas";

// GET /api/thresholds — progi modułów { finfluencer, risk_disclosure, unauthorized_advisory }.
export const GET = handler("thresholds", async () => {
  return NextResponse.json(await getThresholds(getDb()));
});

// PUT /api/thresholds — { module, threshold } z panelu kalibracji. Próg działa od razu na listy,
// statystyki i alerty (liczone w zapytaniach, bez przeliczania wyników). Zdarzenie `thresholds`
// odświeża inne otwarte dashboardy.
export const PUT = handler("thresholds", async (request) => {
  const { module, threshold } = await readBody(request, thresholdUpdateSchema);
  const db = getDb();
  const thresholds = await setThreshold(db, module, threshold);
  await publishEventSafe(db, { type: "thresholds", thresholds });
  return NextResponse.json(thresholds);
});
