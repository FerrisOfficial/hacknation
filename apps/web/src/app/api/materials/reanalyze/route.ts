import { getDb, inArray, materials } from "@app/db";
import { NextResponse } from "next/server";
import { handler, readBody, requireCollectorToken } from "@/lib/api/http";
import { enqueueAnalysis } from "@/lib/pipeline/enqueue";
import { reanalyzeBodySchema } from "@/lib/schemas";

// POST /api/materials/reanalyze { modules: ["unauthorized_advisory"] } — kolejkuje ponowną analizę
// wszystkich materiałów, ale tylko w podanych modułach (np. po wdrożeniu nowego modułu 3):
// wyniki pozostałych modułów zostają. `material_ids` zawęża do wskazanych materiałów.
// Token: COLLECTOR_TOKEN.
export const POST = handler("materials/reanalyze", async (request) => {
  await requireCollectorToken(request);
  const { modules, material_ids } = await readBody(request, reanalyzeBodySchema);
  const query = getDb().select({ id: materials.id }).from(materials);
  const rows = await (material_ids ? query.where(inArray(materials.id, material_ids)) : query);
  const queued = await enqueueAnalysis(
    rows.map((row) => row.id),
    { force: true, modules },
  );
  return NextResponse.json({ materials: rows.length, queued, modules }, { status: 202 });
});
