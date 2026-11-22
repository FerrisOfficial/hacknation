import {
  analysisResults,
  and,
  desc,
  eq,
  getDb,
  gte,
  inArray,
  lte,
  materials,
  sources,
} from "@app/db";
import { NextResponse } from "next/server";
import { HttpError, handler, readQuery } from "@/lib/api/http";
import { getThresholds } from "@/lib/pipeline/thresholds";
import { knfScopeSql } from "@/lib/queries/scope";
import { reportRow, toCsv } from "@/lib/reports";
import { reportModuleSchema, reportQuerySchema } from "@/lib/schemas";

// GET /api/reports/:module?format=csv|json&from=&to=&status=&minScore=&limit=
// Raport modułu dla UKNF: dane podmiotu (firma inwestycyjna / podmiot doradczy), reklamujący,
// treść, dokładny URL, frazy i braki informacji o ryzyku. Domyślnie tylko flagowane (score ≥ próg).
// Okresowa aktualizacja: harmonogram scrapuje źródła ponownie, a raport zawsze czyta bieżący stan.
export const GET = handler(
  "reports/:module",
  async (request, ctx: RouteContext<"/api/reports/[module]">) => {
    const parsedModule = reportModuleSchema.safeParse((await ctx.params).module);
    if (!parsedModule.success) throw new HttpError(404, "Nie ma takiego modułu");
    const module = parsedModule.data;
    const query = readQuery(request, reportQuerySchema);
    const db = getDb();
    const threshold = (await getThresholds(db))[module];

    const rows = await db
      .select({
        resultId: analysisResults.id,
        module: analysisResults.module,
        score: analysisResults.score,
        label: analysisResults.label,
        model: analysisResults.model,
        status: analysisResults.status,
        reviewNote: analysisResults.reviewNote,
        details: analysisResults.details,
        detectedAt: analysisResults.createdAt,
        updatedAt: analysisResults.updatedAt,
        url: materials.url,
        platform: materials.platform,
        title: materials.title,
        author: materials.author,
        text: materials.text,
        publishedAt: materials.publishedAt,
        metadata: materials.metadata,
        sourceName: sources.name,
      })
      .from(analysisResults)
      .innerJoin(materials, eq(materials.id, analysisResults.materialId))
      .leftJoin(sources, eq(sources.id, materials.sourceId))
      .where(
        and(
          eq(analysisResults.module, module),
          gte(analysisResults.score, query.minScore ?? threshold),
          query.status?.length ? inArray(analysisResults.status, query.status) : undefined,
          query.from ? gte(analysisResults.createdAt, query.from) : undefined,
          query.to ? lte(analysisResults.createdAt, query.to) : undefined,
          knfScopeSql(),
        ),
      )
      .orderBy(desc(analysisResults.score), desc(analysisResults.createdAt))
      .limit(query.limit);

    const report = rows.map((row) => reportRow(row, threshold));
    const generatedAt = new Date();
    if (query.format === "json") {
      return NextResponse.json({
        module,
        threshold,
        generatedAt,
        count: report.length,
        rows: report,
      });
    }
    const stamp = generatedAt.toISOString().slice(0, 16).replace(/[:T]/g, "-");
    return new Response(toCsv(report), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="investwatch-${module}-${stamp}.csv"`,
      },
    });
  },
);
