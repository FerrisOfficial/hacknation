import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { handler, readBody } from "@/lib/api/http";
import { getThresholdSettings, saveThresholdSettings } from "@/lib/pipeline/thresholds";
import { publishEventSafe } from "@/lib/realtime/publish";
import { thresholdSettingsUpdateSchema } from "@/lib/schemas";

// GET /api/settings/threshold — docs/KONTRAKT.md §8: { [moduł]: { flag, alert } }.
export const GET = handler("settings/threshold", async () => {
  return NextResponse.json(await getThresholdSettings(getDb()));
});

// PUT /api/settings/threshold — ten sam kształt; pominięty moduł zostaje bez zmian. Wartości
// 0,01–0,99 (zaokrąglane do setnych), alert ≥ flag. Próg `flag` działa od razu na listy, trend
// i statystyki (liczone w zapytaniach), `alert` — na kolejne powiadomienia. Zdarzenie
// `thresholds` odświeża inne otwarte dashboardy. Odpowiedź: wszystkie progi po zapisie.
export const PUT = handler("settings/threshold", async (request) => {
  const update = await readBody(request, thresholdSettingsUpdateSchema);
  const db = getDb();
  const thresholds = await saveThresholdSettings(db, update);
  await publishEventSafe(db, { type: "thresholds", thresholds });
  return NextResponse.json(thresholds);
});
