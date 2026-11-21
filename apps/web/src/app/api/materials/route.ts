import { getDb, type NewMaterial } from "@app/db";
import { NextResponse } from "next/server";
import {
  HttpError,
  handler,
  pgErrorCode,
  readBody,
  readQuery,
  requireCollectorToken,
} from "@/lib/api/http";
import { contentHash } from "@/lib/content-hash";
import { putContent } from "@/lib/content-store";
import { enqueueAnalysis } from "@/lib/pipeline/enqueue";
import { upsertMaterials } from "@/lib/pipeline/materials";
import { listMaterials } from "@/lib/queries/materials";
import { materialsIngestSchema, materialsQuerySchema } from "@/lib/schemas";

// GET /api/materials?platform=&sourceId=&from=&to=&q=&analyzed=&page=&pageSize=
export const GET = handler("materials", async (request) => {
  return NextResponse.json(await listMaterials(getDb(), readQuery(request, materialsQuerySchema)));
});

// POST /api/materials — wgranie materiałów z zewnętrznego kolektora (np. social media zbierane
// poza serwisem ML, eksport z narzędzia, dane od UKNF). `Authorization: Bearer $COLLECTOR_TOKEN`.
// Nowe i zmienione materiały trafiają do kolejki analizy AI.
export const POST = handler("materials", async (request) => {
  await requireCollectorToken(request);
  const input = await readBody(request, materialsIngestSchema);
  const scrapedAt = new Date();
  const rows: NewMaterial[] = await Promise.all(
    input.materials.map(async ({ html, publishedAt, ...material }) => ({
      ...material,
      sourceId: input.sourceId ?? null,
      contentHash: contentHash(material.text),
      contentRef: html ? await putContent(html) : null,
      publishedAt: publishedAt ? new Date(publishedAt) : null,
      scrapedAt,
      metadata: { kind: "ingested", ...material.metadata },
    })),
  );

  const db = getDb();
  let saved: Awaited<ReturnType<typeof upsertMaterials>>;
  try {
    saved = await upsertMaterials(db, rows);
  } catch (error) {
    if (pgErrorCode(error) === "23503")
      throw new HttpError(400, "Nie ma źródła o podanym sourceId");
    throw error;
  }
  const analysisQueued = await enqueueAnalysis(
    saved.filter((m) => m.needsAnalysis).map((m) => m.id),
  );
  return NextResponse.json(
    { materials: saved.map(({ id, needsAnalysis }) => ({ id, needsAnalysis })), analysisQueued },
    { status: 201 },
  );
});
