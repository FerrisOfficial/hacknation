import "server-only";
import { and, type Db, eq, inArray, type ScrapeTrigger, scrapeJobs } from "@app/db";
import { type AnalyzeJobData, getBoss, QUEUES, type ScrapeJobData } from "@/lib/queue/boss";
import { publishEventSafe } from "@/lib/realtime/publish";

export type EnqueueScrapeResult =
  | { status: "queued"; jobId: string }
  // Źródło ma już zadanie w kolejce albo w trakcie (kolejka `stately`, klucz = źródło).
  | { status: "already_queued"; jobId: string | null };

// Wiersz `scrape_jobs` powstaje przed wysłaniem do kolejki, więc worker zawsze go znajdzie,
// a dashboard od razu widzi zadanie jako „queued”.
export async function enqueueScrape(
  db: Db,
  sourceId: string,
  trigger: ScrapeTrigger,
): Promise<EnqueueScrapeResult> {
  const [job] = await db
    .insert(scrapeJobs)
    .values({ sourceId, trigger, status: "queued" })
    .returning({ id: scrapeJobs.id });
  if (!job) throw new Error("Nie udało się utworzyć zadania scrapingu");

  let queueJobId: string | null;
  try {
    const boss = await getBoss();
    const data: ScrapeJobData = { scrapeJobId: job.id };
    queueJobId = await boss.send(QUEUES.scrape, data, { singletonKey: sourceId });
  } catch (error) {
    await db.delete(scrapeJobs).where(eq(scrapeJobs.id, job.id));
    throw error;
  }

  if (!queueJobId) {
    await db.delete(scrapeJobs).where(eq(scrapeJobs.id, job.id));
    const [active] = await db
      .select({ id: scrapeJobs.id })
      .from(scrapeJobs)
      .where(
        and(eq(scrapeJobs.sourceId, sourceId), inArray(scrapeJobs.status, ["queued", "running"])),
      )
      .limit(1);
    return { status: "already_queued", jobId: active?.id ?? null };
  }

  await db.update(scrapeJobs).set({ queueJobId }).where(eq(scrapeJobs.id, job.id));
  await publishEventSafe(db, {
    type: "job",
    jobId: job.id,
    sourceId,
    status: "queued",
    materialsCount: null,
    analysisQueued: null,
    error: null,
  });
  return { status: "queued", jobId: job.id };
}

// Zwraca, ile materiałów faktycznie trafiło do kolejki (już czekające nie są dublowane).
export async function enqueueAnalysis(
  materialIds: readonly string[],
  options: { force?: boolean } = {},
): Promise<number> {
  if (materialIds.length === 0) return 0;
  const boss = await getBoss();
  let queued = 0;
  for (const materialId of materialIds) {
    const data: AnalyzeJobData = { materialId, force: options.force ?? false };
    if (await boss.send(QUEUES.analyze, data, { singletonKey: materialId })) queued++;
  }
  return queued;
}
