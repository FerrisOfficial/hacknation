import "server-only";
import { and, type Db, eq, isNull, materials, or, scrapeJobs, sources, sql } from "@app/db";
import { materialsLimit, schedulerBatch } from "@/lib/materials-limit";
import { scrapePaused } from "./engine";
import { enqueueScrape } from "./enqueue";

// Harmonogram (mechanizm okresowej aktualizacji): co minutę cron pg-boss odpala tick, a tick
// kolejkuje źródła z `interval_minutes`, którym minął termin od ostatniego scrapowania i które nie
// mają zadania w kolejce ani w trakcie. Najwyżej `SCHEDULER_BATCH` źródeł na tick (domyślnie 1,
// od najdawniej scrapowanych): YouTube odpowiada HTTP 429, gdy kilka źródeł zbiera naraz, a
// rozłożenie startów rozkłada też kolejne terminy (każdy liczony od końca własnego zadania).

export async function enqueueDueSources(db: Db): Promise<number> {
  // Silnik wstrzymany przyciskiem w Źródłach: harmonogram nic nie kolejkuje.
  if (await scrapePaused(db)) return 0;
  // Po osiągnięciu limitu materiałów harmonogram stoi (ręczne uruchomienie i API działają dalej).
  const limit = materialsLimit(process.env.MATERIALS_LIMIT);
  if (limit > 0) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(materials);
    if ((row?.count ?? 0) >= limit) return 0;
  }
  const due = await db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.active, true),
        or(
          // Zaplanowane pobranie: raz, gdy nadejdzie jego chwila.
          sql`${sources.scheduledAt} <= now() and (${sources.lastScrapedAt} is null or ${sources.lastScrapedAt} < ${sources.scheduledAt})`,
          and(
            sql`${sources.intervalMinutes} is not null`,
            sql`(${sources.scheduledAt} is null or ${sources.scheduledAt} <= now())`,
            or(
              isNull(sources.lastScrapedAt),
              sql`${sources.lastScrapedAt} + make_interval(mins => ${sources.intervalMinutes}) <= now()`,
            ),
          ),
        ),
        // Zadanie starsze niż godzina z „queued/running” to pozostałość po awarii workera
        // (pg-boss je wygasił) — nie blokuje harmonogramu na zawsze.
        sql`not exists (select 1 from ${scrapeJobs} where ${scrapeJobs.sourceId} = ${sources.id}
          and ${scrapeJobs.status} in ('queued', 'running')
          and ${scrapeJobs.createdAt} > now() - interval '1 hour')`,
      ),
    )
    .orderBy(sql`${sources.lastScrapedAt} asc nulls first`)
    .limit(schedulerBatch(process.env.SCHEDULER_BATCH));

  let queued = 0;
  for (const { id } of due) {
    const result = await enqueueScrape(db, id, "schedule");
    if (result.status === "queued") queued++;
  }
  return queued;
}
