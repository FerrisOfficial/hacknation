import { analysisResults, eq, getDb } from "@app/db";
import { NextResponse } from "next/server";
import { riskLevel } from "@/lib/analysis/modules";
import { HttpError, handler, readBody, readId } from "@/lib/api/http";
import { getThresholds } from "@/lib/pipeline/thresholds";
import { publishEventSafe } from "@/lib/realtime/publish";
import { resultUpdateSchema } from "@/lib/schemas";

// PATCH /api/results/:id — zmiana statusu rekordu przez analityka: new → in_review →
// confirmed (naruszenie) / dismissed (fałszywy alarm). Decyzje confirmed/dismissed są prawdą
// bazową panelu kalibracji. Inne otwarte dashboardy dostają zdarzenie `result` przez Socket.io.
export const PATCH = handler(
  "results/:id",
  async (request, ctx: RouteContext<"/api/results/[id]">) => {
    const id = readId((await ctx.params).id);
    const { status, note } = await readBody(request, resultUpdateSchema);
    const db = getDb();
    const decided = status === "confirmed" || status === "dismissed";
    const [updated] = await db
      .update(analysisResults)
      .set({
        status,
        reviewedAt: decided ? new Date() : null,
        ...(note !== undefined ? { reviewNote: note } : {}),
      })
      .where(eq(analysisResults.id, id))
      .returning();
    if (!updated) throw new HttpError(404, "Nie ma takiego wyniku");

    await publishEventSafe(db, {
      type: "result",
      resultId: updated.id,
      materialId: updated.materialId,
      module: updated.module,
      status: updated.status,
    });
    const threshold = (await getThresholds(db))[updated.module];
    const { reviewedBy: _reviewedBy, ...result } = updated;
    return NextResponse.json({
      ...result,
      threshold,
      riskLevel: riskLevel(updated.score, threshold),
    });
  },
);
