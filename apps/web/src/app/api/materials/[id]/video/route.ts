import { eq, getDb, materials, sql } from "@app/db";
import { NextResponse } from "next/server";
import { HttpError, handler, readId } from "@/lib/api/http";
import { readFramesState } from "@/lib/media-state";
import { requestVideo } from "@/lib/pipeline/video";

// POST /api/materials/:id/video — pobierz film YouTube (serwis media) teraz, także po wcześniejszym
// błędzie. Zwykle niepotrzebne: film z incydentem zamawia analiza albo otwarcie Okna sprawy.
// 202 `queued`, 200 `already_queued` albo `done`, 422 dla materiałów spoza YouTube.
export const POST = handler(
  "materials/:id/video",
  async (_request, ctx: RouteContext<"/api/materials/[id]/video">) => {
    const db = getDb();
    const [material] = await db
      .select({
        id: materials.id,
        platform: materials.platform,
        frames: sql<unknown>`${materials.metadata}->'frames'`,
      })
      .from(materials)
      .where(eq(materials.id, readId((await ctx.params).id)));
    if (!material) throw new HttpError(404, "Nie ma takiego materiału");
    if (material.platform !== "youtube") throw new HttpError(422, "Pobieramy tylko filmy YouTube");
    if (readFramesState(material.frames)?.status === "done") {
      return NextResponse.json({ status: "done" });
    }
    const queued = await requestVideo(db, material, { retry: true });
    return NextResponse.json(
      { status: queued ? "queued" : "already_queued" },
      { status: queued ? 202 : 200 },
    );
  },
);
