import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { HttpError, handler, readId } from "@/lib/api/http";
import { getThresholds } from "@/lib/pipeline/thresholds";
import { getIncident } from "@/lib/queries/results";

// GET /api/materials/:id — zunifikowany obiekt: materiał (z tekstem i metadanymi) + wyniki
// modułów 1–3 z poziomem ryzyka względem aktualnych progów.
export const GET = handler(
  "materials/:id",
  async (_request, ctx: RouteContext<"/api/materials/[id]">) => {
    const db = getDb();
    const incident = await getIncident(db, readId((await ctx.params).id), await getThresholds(db));
    if (!incident) throw new HttpError(404, "Nie ma takiego materiału");
    return NextResponse.json(incident);
  },
);
