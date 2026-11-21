import { z } from "zod";
import { analysisResultsInputSchema } from "@/lib/analysis/contract";
import { ANALYSIS_MODULES, PLATFORMS, REVIEW_STATUSES, RISK_LEVELS } from "@/lib/analysis/modules";

// Schematy Zod współdzielone przez formularze (klient) i route handlery (serwer).
export const predictInputSchema = z.object({
  text: z.string().trim().min(3, "Wpisz co najmniej 3 znaki").max(2000, "Maksymalnie 2000 znaków"),
});

export type PredictInput = z.infer<typeof predictInputSchema>;

// POST /api/collect/youtube — uruchomienie kolektora YouTube z zapisem do bazy.
export const youtubeCollectInputSchema = z.object({
  query: z.string().trim().min(2, "Fraza musi mieć co najmniej 2 znaki").max(200),
  limit: z.number().int().min(1).max(50).default(10),
  // Tylko filmy z etykietą „Zawiera płatną promocję”.
  paidOnly: z.boolean().default(true),
});

export type YoutubeCollectInput = z.infer<typeof youtubeCollectInputSchema>;

// ─── Źródła ─────────────────────────────────────────────────────────────────────────────────

const httpUrl = z
  .url({ protocol: /^https?$/, message: "Podaj adres http(s)://" })
  .max(2000, "Adres jest za długi");

// Co ile minut harmonogram ponawia scrapowanie (null = tylko ręcznie). Od 5 min do 30 dni.
const intervalMinutes = z.number().int().min(5).max(43_200).nullable();

const sourceCommon = {
  name: z.string().trim().min(1).max(200).optional(),
  intervalMinutes: intervalMinutes.default(null),
  active: z.boolean().default(true),
  // Od razu dodaj zadanie scrapingu do kolejki.
  runNow: z.boolean().default(true),
};

export const sourceCreateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("web_page"),
    url: httpUrl,
    // Bez podania — rozpoznajemy po domenie (facebook.com → facebook itd.).
    platform: z.enum(PLATFORMS).optional(),
    ...sourceCommon,
  }),
  z.object({
    kind: z.literal("youtube_search"),
    query: z.string().trim().min(2, "Fraza musi mieć co najmniej 2 znaki").max(200),
    limit: z.number().int().min(1).max(50).default(10),
    paidOnly: z.boolean().default(true),
    ...sourceCommon,
  }),
]);

export type SourceCreateInput = z.input<typeof sourceCreateSchema>;
export type SourceCreate = z.output<typeof sourceCreateSchema>;

export const sourceUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    active: z.boolean(),
    intervalMinutes,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Brak pól do zmiany" });

export type SourceUpdateInput = z.infer<typeof sourceUpdateSchema>;

// ─── Wyniki, alerty, kalibracja ─────────────────────────────────────────────────────────────

export const resultUpdateSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
  note: z.string().trim().max(2000).nullable().optional(),
});

export type ResultUpdateInput = z.infer<typeof resultUpdateSchema>;

export const thresholdUpdateSchema = z.object({
  module: z.enum(ANALYSIS_MODULES),
  // Setne części — tak samo dokładnie liczy histogram w panelu kalibracji.
  threshold: z
    .number()
    .min(0.01)
    .max(0.99)
    .transform((value) => Math.round(value * 100) / 100),
});

export type ThresholdUpdateInput = z.infer<typeof thresholdUpdateSchema>;

// ─── Wgrywanie danych z zewnątrz (token kolektora) ──────────────────────────────────────────

export const materialIngestSchema = z.object({
  url: httpUrl,
  platform: z.enum(PLATFORMS).default("web"),
  title: z.string().trim().max(1000).nullable().optional(),
  author: z.string().trim().max(500).nullable().optional(),
  text: z.string().trim().min(1).max(500_000),
  html: z.string().max(5_000_000).optional(),
  language: z.string().trim().max(20).nullable().optional(),
  publishedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const materialsIngestSchema = z.object({
  sourceId: z.uuid().optional(),
  materials: z.array(materialIngestSchema).min(1).max(200),
});

export type MaterialsIngestInput = z.input<typeof materialsIngestSchema>;

export const analysisIngestSchema = z.object({ results: analysisResultsInputSchema.min(1) });

// ─── Parametry zapytań (query string) ───────────────────────────────────────────────────────
// Listy po przecinku: ?module=finfluencer,unauthorized_advisory&risk=medium,high

function csv<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values)))
    .optional();
}

const dateParam = z.coerce.date().optional();
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
};

export const resultsQuerySchema = z.object({
  module: csv(ANALYSIS_MODULES),
  status: csv(REVIEW_STATUSES),
  risk: csv(RISK_LEVELS),
  platform: csv(PLATFORMS),
  sourceId: z.uuid().optional(),
  // Data wykrycia (analysis_results.created_at), domknięta z obu stron.
  from: dateParam,
  to: dateParam,
  q: z.string().trim().min(1).max(200).optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
  sort: z.enum(["date", "score"]).default("date"),
  ...pagination,
});

export type ResultsQuery = z.infer<typeof resultsQuerySchema>;

export const materialsQuerySchema = z.object({
  platform: csv(PLATFORMS),
  sourceId: z.uuid().optional(),
  from: dateParam,
  to: dateParam,
  q: z.string().trim().min(1).max(200).optional(),
  analyzed: z.enum(["true", "false"]).optional(),
  ...pagination,
});

export type MaterialsQuery = z.infer<typeof materialsQuerySchema>;

export const jobsQuerySchema = z.object({
  sourceId: z.uuid().optional(),
  status: csv(["queued", "running", "done", "failed"]),
  ...pagination,
});

export type JobsQuery = z.infer<typeof jobsQuerySchema>;

export const trendQuerySchema = z.object({
  bucket: z.enum(["hour", "day", "week"]).default("day"),
  from: dateParam,
  to: dateParam,
  module: csv(ANALYSIS_MODULES),
  platform: csv(PLATFORMS),
  // Domyślnie liczymy tylko flagowane (score ≥ próg); `all` — wszystkie przeanalizowane.
  scope: z.enum(["flagged", "high", "all"]).default("flagged"),
});

export type TrendQuery = z.infer<typeof trendQuerySchema>;

export const calibrationQuerySchema = z.object({
  module: z.enum(ANALYSIS_MODULES),
  // Próg do podglądu (bez zapisu). Brak = zapisany próg modułu.
  threshold: z.coerce.number().min(0).max(1).optional(),
});

export const reportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  from: dateParam,
  to: dateParam,
  status: csv(REVIEW_STATUSES),
  // Domyślnie tylko flagowane (score ≥ próg modułu).
  minScore: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().min(1).max(10_000).default(5_000),
});

export const reportModuleSchema = z.enum(ANALYSIS_MODULES);
