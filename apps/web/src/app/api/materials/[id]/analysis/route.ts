import { eq, getDb, materials } from "@app/db";
import { NextResponse } from "next/server";
import { HttpError, handler, readBody, readId, requireCollectorToken } from "@/lib/api/http";
import { saveAnalysisResults } from "@/lib/pipeline/results";
import { getThresholds } from "@/lib/pipeline/thresholds";
import { getIncident } from "@/lib/queries/results";
import { analysisIngestSchema } from "@/lib/schemas";

// PUT /api/materials/:id/analysis — wyniki modułów AI wypchnięte z zewnątrz (skrypt, notebook,
// batch w serwisie ML) zamiast przez kolejkę. Kontrakt jak odpowiedź POST /analyze:
// { results: [{ module, score, label, model, details }] }. Token: COLLECTOR_TOKEN.
// Przekroczenie progu wysyła alert przez Socket.io tak samo jak wynik z kolejki.
export const PUT = handler(
  "materials/:id/analysis",
  async (request, ctx: RouteContext<"/api/materials/[id]/analysis">) => {
    await requireCollectorToken(request);
    const id = readId((await ctx.params).id);
    const { results } = await readBody(request, analysisIngestSchema);
    const db = getDb();
    const [material] = await db.select().from(materials).where(eq(materials.id, id));
    if (!material) throw new HttpError(404, "Nie ma takiego materiału");
    await saveAnalysisResults(db, material, results);
    return NextResponse.json(await getIncident(db, id, await getThresholds(db)));
  },
);
