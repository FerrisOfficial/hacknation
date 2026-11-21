import "server-only";
import {
  and,
  count,
  type Db,
  desc,
  eq,
  inArray,
  materials,
  type ScrapeJob,
  type Source,
  scrapeJobs,
  sources,
} from "@app/db";
import type { JobsQuery } from "@/lib/schemas";
import type { Page } from "./results";

export type SourceView = Source & {
  materialsCount: number;
  lastJob: Pick<
    ScrapeJob,
    "id" | "status" | "trigger" | "createdAt" | "finishedAt" | "error"
  > | null;
  nextRunAt: Date | null;
};

function nextRunAt(source: Source): Date | null {
  if (!source.active || source.intervalMinutes === null) return null;
  if (!source.lastScrapedAt) return new Date();
  return new Date(source.lastScrapedAt.getTime() + source.intervalMinutes * 60_000);
}

export async function listSources(db: Db, ids?: string[]): Promise<SourceView[]> {
  const where = ids ? inArray(sources.id, ids) : undefined;
  const [rows, counts, lastJobs] = await Promise.all([
    db.select().from(sources).where(where).orderBy(desc(sources.createdAt)),
    db
      .select({ sourceId: materials.sourceId, n: count() })
      .from(materials)
      .where(ids ? inArray(materials.sourceId, ids) : undefined)
      .groupBy(materials.sourceId),
    db
      .selectDistinctOn([scrapeJobs.sourceId], {
        sourceId: scrapeJobs.sourceId,
        id: scrapeJobs.id,
        status: scrapeJobs.status,
        trigger: scrapeJobs.trigger,
        createdAt: scrapeJobs.createdAt,
        finishedAt: scrapeJobs.finishedAt,
        error: scrapeJobs.error,
      })
      .from(scrapeJobs)
      .where(ids ? inArray(scrapeJobs.sourceId, ids) : undefined)
      .orderBy(scrapeJobs.sourceId, desc(scrapeJobs.createdAt)),
  ]);
  const countBySource = new Map(counts.map((row) => [row.sourceId, row.n]));
  const jobBySource = new Map(lastJobs.map(({ sourceId, ...job }) => [sourceId, job]));
  return rows.map((source) => ({
    ...source,
    materialsCount: countBySource.get(source.id) ?? 0,
    lastJob: jobBySource.get(source.id) ?? null,
    nextRunAt: nextRunAt(source),
  }));
}

export async function getSource(db: Db, id: string): Promise<SourceView | null> {
  const [source] = await listSources(db, [id]);
  return source ?? null;
}

export type JobView = ScrapeJob & {
  sourceName: string;
  sourceUrl: string;
  platform: Source["platform"];
};

const jobColumns = {
  job: scrapeJobs,
  sourceName: sources.name,
  sourceUrl: sources.url,
  platform: sources.platform,
};

export async function listJobs(db: Db, query: JobsQuery): Promise<Page<JobView>> {
  const where = and(
    query.sourceId ? eq(scrapeJobs.sourceId, query.sourceId) : undefined,
    query.status?.length ? inArray(scrapeJobs.status, query.status) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select(jobColumns)
      .from(scrapeJobs)
      .innerJoin(sources, eq(sources.id, scrapeJobs.sourceId))
      .where(where)
      .orderBy(desc(scrapeJobs.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ value: count() }).from(scrapeJobs).where(where),
  ]);
  return {
    items: rows.map(({ job, ...source }) => ({ ...job, ...source })),
    total: total?.value ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getJob(db: Db, id: string): Promise<JobView | null> {
  const [row] = await db
    .select(jobColumns)
    .from(scrapeJobs)
    .innerJoin(sources, eq(sources.id, scrapeJobs.sourceId))
    .where(eq(scrapeJobs.id, id));
  return row
    ? { ...row.job, sourceName: row.sourceName, sourceUrl: row.sourceUrl, platform: row.platform }
    : null;
}
