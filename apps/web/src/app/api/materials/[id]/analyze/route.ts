import { eq, getDb, materials } from "@app/db";
import { NextResponse } from "next/server";
import { HttpError, handler, readId } from "@/lib/api/http";
import { enqueueAnalysis } from "@/lib/pipeline/enqueue";

// POST /api/materials/:id/analyze — ponowna analiza AI (np. po zmianie modelu), także gdy treść
// się nie zmieniła. 202 = w kolejce, 200 = już czekał w kolejce.
export const POST = handler(
  "materials/:id/analyze",
  async (_request, ctx: RouteContext<"/api/materials/[id]/analyze">) => {
    const id = readId((await ctx.params).id);
    const [material] = await getDb()
      .select({ id: materials.id })
      .from(materials)
      .where(eq(materials.id, id));
    if (!material) throw new HttpError(404, "Nie ma takiego materiału");
    const queued = await enqueueAnalysis([id], { force: true });
    return NextResponse.json(
      { status: queued ? "queued" : "already_queued" },
      { status: queued ? 202 : 200 },
    );
  },
);
