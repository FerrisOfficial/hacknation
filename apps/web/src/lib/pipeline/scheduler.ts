import "server-only";
import { and, type Db, eq, isNull, or, scrapeJobs, sources, sql } from "@app/db";
import { enqueueScrape } from "./enqueue";

// Harmonogram (mechanizm okresowej aktualizacji): co minutę cron pg-boss odpala tick, a tick
// kolejkuje źródła z `interval_minutes`, którym minął termin od ostatniego scrapowania i które nie
// mają zadania w kolejce ani w trakcie. Najwyżej `SCHEDULER_BATCH` źródeł na tick (od najdawniej
// scrapowanych): YouTube odpowiada HTTP 429, gdy kilkadziesiąt źródeł rusza naraz, a rozłożenie
// startów rozkłada też kolejne terminy (każdy liczony od końca własnego zadania).
export const SCHEDULER_BATCH = 4;

export async function enqueueDueSources(db: Db): Promise<number> {
  const due = await db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.active, true),
        sql`${sources.intervalMinutes} is not null`,
        or(
          isNull(sources.lastScrapedAt),
          sql`${sources.lastScrapedAt} + make_interval(mins => ${sources.intervalMinutes}) <= now()`,
        ),
        // Zadanie starsze niż godzina z „queued/running” to pozostałość po awarii workera
        // (pg-boss je wygasił) — nie blokuje harmonogramu na zawsze.
        sql`not exists (select 1 from ${scrapeJobs} where ${scrapeJobs.sourceId} = ${sources.id}
          and ${scrapeJobs.status} in ('queued', 'running')
          and ${scrapeJobs.createdAt} > now() - interval '1 hour')`,
      ),
    )
    .orderBy(sql`${sources.lastScrapedAt} asc nulls first`)
    .limit(SCHEDULER_BATCH);

  let queued = 0;
  for (const { id } of due) {
    const result = await enqueueScrape(db, id, "schedule");
    if (result.status === "queued") queued++;
  }
  return queued;
}
