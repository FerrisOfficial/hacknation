import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { HttpError, handler, readBody, readId } from "@/lib/api/http";
import { getIncidentDetail, updateIncidentStatus } from "@/lib/queries/incidents";
import { publishEventSafe } from "@/lib/realtime/publish";
import { incidentUpdateSchema } from "@/lib/schemas";

// GET /api/incidents/:id — docs/KONTRAKT.md §5: wynik modułu, materiał i `details` (§3).
export const GET = handler(
  "incidents/:id",
  async (_request, ctx: RouteContext<"/api/incidents/[id]">) => {
    const incident = await getIncidentDetail(getDb(), readId((await ctx.params).id));
    if (!incident) throw new HttpError(404, "Nie ma takiego incydentu");
    return NextResponse.json(incident);
  },
);

// PATCH /api/incidents/:id — docs/KONTRAKT.md §6: { status }. confirmed/dismissed to prawda
// bazowa panelu kalibracji. Inne otwarte dashboardy dostają zdarzenie `result` przez Socket.io.
// Odpowiedź: szczegół incydentu po zmianie (kształt jak w GET).
export const PATCH = handler(
  "incidents/:id",
  async (request, ctx: RouteContext<"/api/incidents/[id]">) => {
    const id = readId((await ctx.params).id);
    const { status } = await readBody(request, incidentUpdateSchema);
    const db = getDb();
    const updated = await updateIncidentStatus(db, id, status);
    if (!updated) throw new HttpError(404, "Nie ma takiego incydentu");
    await publishEventSafe(db, {
      type: "result",
      resultId: updated.id,
      materialId: updated.materialId,
      module: updated.module,
      status: updated.status,
    });
    return NextResponse.json(await getIncidentDetail(db, id));
  },
);
