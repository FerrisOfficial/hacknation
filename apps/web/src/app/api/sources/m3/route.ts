import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { handler, requireCollectorToken } from "@/lib/api/http";
import { M3_SEARCH_INTERVAL_MINUTES } from "@/lib/m3-sources";
import { seedM3Sources } from "@/lib/pipeline/m1-sources";

// POST /api/sources/m3 — źródła modułu 3: frazy, pod którymi oferuje się doradztwo poza firmami
// inwestycyjnymi (sygnały VIP, mentoring, konsultacje 1:1, wealth management, family office),
// wszystkie filmy z linkami z opisu. Harmonogram scrapuje je od razu, potem co 12 h. Idempotentne.
// Token: COLLECTOR_TOKEN.
export const POST = handler("sources/m3", async (request) => {
  await requireCollectorToken(request);
  const { sources } = await seedM3Sources(getDb());
  return NextResponse.json({ sources, intervalMinutes: M3_SEARCH_INTERVAL_MINUTES });
});
