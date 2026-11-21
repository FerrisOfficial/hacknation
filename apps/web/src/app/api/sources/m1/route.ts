import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { handler, requireCollectorToken } from "@/lib/api/http";
import { M1_SEARCH_INTERVAL_MINUTES } from "@/lib/m1-sources";
import { seedM1Sources } from "@/lib/pipeline/m1-sources";

// POST /api/sources/m1 — źródła modułu 1: frazy „{marka} kod / polecam / jak założyć konto /
// recenzja” dla marek firm inwestycyjnych (`@/lib/analysis/brands`), wszystkie filmy, nie tylko
// płatne promocje. Harmonogram scrapuje je od razu, potem co 12 h. Idempotentne.
// Token: COLLECTOR_TOKEN.
export const POST = handler("sources/m1", async (request) => {
  await requireCollectorToken(request);
  const { sources } = await seedM1Sources(getDb());
  return NextResponse.json({ sources, intervalMinutes: M1_SEARCH_INTERVAL_MINUTES });
});
