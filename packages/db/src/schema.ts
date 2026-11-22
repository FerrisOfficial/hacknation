import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Przykładowa tabela — zmień albo usuń. Po każdej zmianie schematu: `pnpm db:generate`.
//
// `.enableRLS()` zostało z czasów Supabase (chroniło tabele przed jego publicznym REST API).
// Na lokalnym Postgresie nie przeszkadza: aplikacja łączy się jako właściciel tabel, a właściciela
// RLS bez polityk nie ogranicza. Nowe tabele go nie potrzebują.
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notes_user_id_idx").on(table.userId)],
).enableRLS();

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;

// ─── Pipeline scrapingu i analizy (#InvestWatch) ────────────────────────────────────────────
// sources → scrape_jobs → materials → analysis_results (po jednym wyniku na moduł AI).
// Status rekordu (do zmiany w dashboardzie) żyje na analysis_results — próg kalibracji
// porównujemy ze `score`, więc alert = wynik powyżej progu, bez osobnej tabeli.

export const platform = pgEnum("platform", [
  "web",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "linkedin",
  "telegram",
]);

export const scrapeJobStatus = pgEnum("scrape_job_status", ["queued", "running", "done", "failed"]);

export const analysisModule = pgEnum("analysis_module", [
  "finfluencer",
  "risk_disclosure",
  "unauthorized_advisory",
]);

// `postponed` (Odłożony): analityk wraca do sprawy później. Kalibracja traktuje go jak brak decyzji.
export const reviewStatus = pgEnum("review_status", [
  "new",
  "in_review",
  "postponed",
  "confirmed",
  "dismissed",
]);

// Zdarzenia w historii incydentu: oflagowanie, alert i ponowna analiza (system) albo zmiana statusu.
export const incidentEventKind = pgEnum("incident_event_kind", [
  "flagged",
  "alert",
  "reanalyzed",
  "status",
]);

// Kto uruchomił zadanie scrapingu: harmonogram (cron), analityk z dashboardu albo API (skrypt).
export const scrapeTrigger = pgEnum("scrape_trigger", ["schedule", "manual", "api"]);

// Konfiguracja źródła zależna od rodzaju. `youtube_search`: fraza w wyszukiwarce YouTube.
// `web_page`: pojedyncza strona (social media bez API też — publiczny profil jako strona WWW).
// `youtube_channel`: najnowsze filmy kanału (moduł 1 obserwuje kanały, w których znalazł reklamę).
export type SourceConfig =
  | { kind: "web_page" }
  | { kind: "youtube_search"; query: string; limit: number; paidOnly: boolean }
  | { kind: "youtube_channel"; channelUrl: string; limit: number };

// Monitorowana strona albo profil w social mediach.
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: platform("platform").notNull().default("web"),
    url: text("url").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    config: jsonb("config").$type<SourceConfig>().notNull().default({ kind: "web_page" }),
    // Co ile minut harmonogram scrapuje źródło ponownie. null = tylko ręcznie.
    intervalMinutes: integer("interval_minutes"),
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
    // Zaplanowane pobranie: harmonogram nie rusza źródła przed tą chwilą, a o tej chwili pobiera
    // je raz (także przy „tylko ręcznie”). null = bez planu.
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sources_url_idx").on(table.url),
    index("sources_platform_idx").on(table.platform),
  ],
).enableRLS();

// Jedno uruchomienie scrapera dla źródła (kolejka + historia).
export const scrapeJobs = pgTable(
  "scrape_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    status: scrapeJobStatus("status").notNull().default("queued"),
    trigger: scrapeTrigger("trigger").notNull().default("api"),
    // Id zadania w kolejce pg-boss (schemat `pgboss`) — korelacja kolejki z historią.
    queueJobId: text("queue_job_id"),
    // Ile materiałów zapisało zadanie i ile z nich trafiło do kolejki analizy AI.
    materialsCount: integer("materials_count"),
    analysisQueued: integer("analysis_queued"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("scrape_jobs_source_id_idx").on(table.sourceId),
    index("scrape_jobs_status_idx").on(table.status),
    index("scrape_jobs_created_at_idx").on(table.createdAt),
  ],
).enableRLS();

// Zescrapowany materiał (reklama, post, strona oferty).
export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => scrapeJobs.id, { onDelete: "set null" }),
    // Rodzaj treści (film z YouTube, strona WWW…). Źródło (`sources`) mówi, skąd materiał
    // znaleźliśmy — np. strona z linku w opisie filmu ma platform = web, a źródło YouTube.
    platform: platform("platform").notNull().default("web"),
    url: text("url").notNull(),
    title: text("title"),
    // Kto publikuje (finfluencer, firma, strona) — moduł 1 odróżnia reklamującego od firmy.
    author: text("author"),
    // Surowy HTML albo odnośnik do object storage (np. s3://…), jeśli treść jest duża.
    rawHtml: text("raw_html"),
    contentRef: text("content_ref"),
    // Tekst po preprocessingu (bez tagów, znormalizowane białe znaki).
    text: text("text").notNull(),
    // SHA-256 znormalizowanego tekstu — deduplikacja tych samych treści pod różnymi URL-ami.
    contentHash: text("content_hash").notNull(),
    language: text("language"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).notNull().defaultNow(),
    // `contentHash` z chwili ostatniej analizy AI. Inny niż `contentHash` = treść się zmieniła
    // (albo nie była analizowana) i materiał wraca do kolejki analizy.
    analyzedHash: text("analyzed_hash"),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    // Dane zależne od platformy, np. YouTube: etykieta płatnej promocji, kody promocyjne,
    // linki z opisu, napisy z czasem (do linku `&t=…s`). Kształt: `kind` + pola tego rodzaju.
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex("materials_url_idx").on(table.url),
    index("materials_content_hash_idx").on(table.contentHash),
    index("materials_source_id_idx").on(table.sourceId),
    index("materials_scraped_at_idx").on(table.scrapedAt),
    index("materials_platform_idx").on(table.platform),
  ],
).enableRLS();

// Analityk, który podejmuje decyzje w dashboardzie (autor decyzji, R16). Logowania nie ma, więc
// aplikacja wpisuje tu użytkownika z env (UI_USER_*). Wiersz zostaje, żeby historia miała autora.
export const reviewers = pgTable("reviewers", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Wynik jednego modułu AI dla materiału. `status` zmienia analityk w dashboardzie.
export const analysisResults = pgTable(
  "analysis_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    module: analysisModule("module").notNull(),
    // 0–1: prawdopodobieństwo naruszenia. Próg z panelu kalibracji porównujemy z tą wartością.
    // M2: najwyższy score reguły (`rule_scores` z serwisu ML), czyli incydent = któraś reguła ≥ próg.
    score: real("score").notNull(),
    // 0–1: priorytet do sortowania listy incydentów (M2: `risk_score` z ML, ze wszystkich reguł).
    // Nie porównujemy go z progiem. null = brak (M1, M3, starsze wyniki) — sortujemy wtedy po score.
    riskScore: real("risk_score"),
    label: text("label").notNull(),
    // Szczegóły modułu: znalezione frazy, firma inwestycyjna, brakujące elementy informacji o ryzyku…
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    model: text("model").notNull(),
    status: reviewStatus("status").notNull().default("new"),
    reviewedBy: uuid("reviewed_by").references(() => reviewers.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    // Pierwsze wykrycie (trend incydentów w czasie) — ponowna analiza go nie zmienia.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("analysis_results_material_id_idx").on(table.materialId),
    // Jeden wynik na moduł: ponowna analiza nadpisuje score, status przeglądu zostaje.
    uniqueIndex("analysis_results_material_module_idx").on(table.materialId, table.module),
    index("analysis_results_module_score_idx").on(table.module, table.score),
    index("analysis_results_status_idx").on(table.status),
    index("analysis_results_created_at_idx").on(table.createdAt),
  ],
).enableRLS();

// Historia incydentu (Okno sprawy, teczka podmiotu): co i kiedy się z nim działo.
// `actor_id` = null to system (pipeline analizy), inaczej analityk z `reviewers`.
export const incidentEvents = pgTable(
  "incident_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resultId: uuid("result_id")
      .notNull()
      .references(() => analysisResults.id, { onDelete: "cascade" }),
    kind: incidentEventKind("kind").notNull(),
    actorId: uuid("actor_id").references(() => reviewers.id, { onDelete: "set null" }),
    // Opis dla człowieka, np. „oflagowano 0,84 przy progu 0,55”, „Odłożony: dowód niepełny”.
    action: text("action").notNull(),
    // Status po zdarzeniu (tylko `kind = status`).
    status: reviewStatus("status"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("incident_events_result_at_idx").on(table.resultId, table.at)],
);

// Progi kalibracji per moduł (panel kalibracji). Brak wiersza = domyślne progi z aplikacji.
// `threshold` (próg `flag`): wynik ze `score >= threshold` jest incydentem, poniżej — negatywny.
// `alert_threshold` (próg `alert`): od niego leci powiadomienie `incident.high_risk`. null = domyślny.
export const moduleSettings = pgTable("module_settings", {
  module: analysisModule("module").primaryKey(),
  threshold: real("threshold").notNull(),
  alertThreshold: real("alert_threshold"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Ustawienia całej aplikacji (klucz → wartość). Np. `scrape_paused`: harmonogram stoi.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type ScrapeJob = typeof scrapeJobs.$inferSelect;
export type NewScrapeJob = typeof scrapeJobs.$inferInsert;
export type Material = typeof materials.$inferSelect;
export type NewMaterial = typeof materials.$inferInsert;
export type AnalysisResult = typeof analysisResults.$inferSelect;
export type NewAnalysisResult = typeof analysisResults.$inferInsert;
export type ModuleSetting = typeof moduleSettings.$inferSelect;
export type ReviewerRow = typeof reviewers.$inferSelect;
export type IncidentEvent = typeof incidentEvents.$inferSelect;
export type NewIncidentEvent = typeof incidentEvents.$inferInsert;
export type IncidentEventKind = (typeof incidentEventKind.enumValues)[number];
export type Platform = (typeof platform.enumValues)[number];
export type AnalysisModule = (typeof analysisModule.enumValues)[number];
export type ReviewStatus = (typeof reviewStatus.enumValues)[number];
export type ScrapeJobStatus = (typeof scrapeJobStatus.enumValues)[number];
export type ScrapeTrigger = (typeof scrapeTrigger.enumValues)[number];
