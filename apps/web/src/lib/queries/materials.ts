import "server-only";
import {
  and,
  count,
  type Db,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  materials,
  or,
  sources,
  sql,
} from "@app/db";
import type { MaterialsQuery } from "@/lib/schemas";
import { escapeLike, type MaterialSummary, type Page } from "./results";
import { knfScopeSql } from "./scope";

const resultInScope = knfScopeSql(sql.raw("r.module"), sql.raw("r.details"));

export type MaterialListItem = MaterialSummary & {
  analyzedAt: Date | null;
  resultsCount: number;
  maxScore: number | null;
};

// GET /api/materials — wszystko, co zebrał silnik scrapingu (także materiały bez analizy).
export async function listMaterials(
  db: Db,
  query: MaterialsQuery,
): Promise<Page<MaterialListItem>> {
  const pattern = query.q ? `%${escapeLike(query.q)}%` : null;
  const where = and(
    query.platform?.length ? inArray(materials.platform, query.platform) : undefined,
    query.sourceId ? eq(materials.sourceId, query.sourceId) : undefined,
    query.from ? gte(materials.scrapedAt, query.from) : undefined,
    query.to ? lte(materials.scrapedAt, query.to) : undefined,
    query.analyzed === "true" ? sql`${materials.analyzedAt} is not null` : undefined,
    query.analyzed === "false" ? sql`${materials.analyzedAt} is null` : undefined,
    pattern
      ? or(
          ilike(materials.title, pattern),
          ilike(materials.url, pattern),
          ilike(materials.author, pattern),
          ilike(materials.text, pattern),
        )
      : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: materials.id,
        url: materials.url,
        title: materials.title,
        author: materials.author,
        platform: materials.platform,
        publishedAt: materials.publishedAt,
        scrapedAt: materials.scrapedAt,
        sourceId: materials.sourceId,
        sourceName: sources.name,
        analyzedAt: materials.analyzedAt,
        resultsCount: sql<number>`(select count(*)::int from analysis_results r where r.material_id = ${materials.id} and ${resultInScope})`,
        maxScore: sql<
          number | null
        >`(select max(r.score) from analysis_results r where r.material_id = ${materials.id} and ${resultInScope})`,
      })
      .from(materials)
      .leftJoin(sources, eq(sources.id, materials.sourceId))
      .where(where)
      .orderBy(desc(materials.scrapedAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ value: count() }).from(materials).where(where),
  ]);
  return { items: rows, total: total?.value ?? 0, page: query.page, pageSize: query.pageSize };
}
