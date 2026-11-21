import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { collectorAccess } from "@/lib/collect/auth";
import { CollectError, collectYoutube } from "@/lib/collect/youtube";
import { ml } from "@/lib/ml";
import { youtubeCollectInputSchema } from "@/lib/schemas";

// POST /api/collect/youtube — kolektor YouTube w serwisie ML + zapis do sources/scrape_jobs/materials.
// Dla crona i skryptów: `Authorization: Bearer $COLLECTOR_TOKEN`, body { query, limit?, paidOnly? }.
export async function POST(request: Request) {
  const access = await collectorAccess(
    request.headers.get("authorization"),
    process.env.COLLECTOR_TOKEN,
  );
  if (access === "disabled") {
    return NextResponse.json(
      { error: "Kolektor wyłączony — ustaw COLLECTOR_TOKEN w env aplikacji" },
      { status: 503 },
    );
  }
  if (access === "unauthorized") {
    return NextResponse.json({ error: "Zły albo brak tokenu kolektora" }, { status: 401 });
  }

  const parsed = youtubeCollectInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }

  try {
    return NextResponse.json(await collectYoutube(getDb(), ml, parsed.data));
  } catch (error) {
    if (error instanceof CollectError) {
      return NextResponse.json({ error: error.message, jobId: error.jobId }, { status: 502 });
    }
    console.error("[api/collect/youtube] Błąd zapisu:", error);
    return NextResponse.json({ error: "Nie udało się zapisać wyników" }, { status: 500 });
  }
}
