import { getDb } from "@app/db";
import { after, NextResponse } from "next/server";
import { HttpError, handler, readBody, readId } from "@/lib/api/http";
import { requestVideo } from "@/lib/pipeline/video";
import {
  getIncidentDetail,
  getIncidentVideoCandidate,
  updateIncidentStatus,
} from "@/lib/queries/incidents";
import { publishEventSafe } from "@/lib/realtime/publish";
import { incidentUpdateSchema } from "@/lib/schemas";

// GET /api/incidents/:id — docs/KONTRAKT.md §5: wynik modułu, materiał, `details` (§3), decyzja
// analityka z autorem i historia. Film YouTube bez kopii idzie po odpowiedzi do pobrania (incydenty
// sprzed serwisu media); gdy będzie gotowy, zdarzenie `result` odświeży Okno sprawy.
export const GET = handler(
  "incidents/:id",
  async (_request, ctx: RouteContext<"/api/incidents/[id]">) => {
    const db = getDb();
    const id = readId((await ctx.params).id);
    const incident = await getIncidentDetail(db, id);
    if (!incident) throw new HttpError(404, "Nie ma takiego incydentu");
    if (incident.material.platform === "youtube" && !incident.material.has_video) {
      after(async () => {
        const material = await getIncidentVideoCandidate(db, id);
        if (material) await requestVideo(db, material);
      });
    }
    return NextResponse.json(incident);
  },
);

// PATCH /api/incidents/:id — docs/KONTRAKT.md §6: { status, review_note? }. Zapisuje autora
// (GET /api/me) i czas decyzji, dopisuje zdarzenie do historii. confirmed/dismissed to prawda
// bazowa panelu kalibracji. Inne otwarte dashboardy dostają zdarzenie `result` przez Socket.io.
// Odpowiedź: szczegół incydentu po zmianie (kształt jak w GET).
export const PATCH = handler(
  "incidents/:id",
  async (request, ctx: RouteContext<"/api/incidents/[id]">) => {
    const id = readId((await ctx.params).id);
    const { status, review_note } = await readBody(request, incidentUpdateSchema);
    const db = getDb();
    const updated = await updateIncidentStatus(db, id, { status, note: review_note });
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
