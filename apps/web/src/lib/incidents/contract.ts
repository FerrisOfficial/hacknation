import type { AnalysisModule, Platform, ReviewStatus } from "@app/db";
import { z } from "zod";

// Kształty odpowiedzi REST dla dashboardu — docs/KONTRAKT.md (§3–§10). Ten plik importuje też
// przeglądarka (typy do useQuery), więc bez kodu serwerowego.

// ─── §3: analysis_results.details ───────────────────────────────────────────────────────────

export type FlagResult = "violation" | "ok" | "n/a";
export type RuleKind = "hard" | "suggestion";

export type Evidence = {
  quote: string;
  start: number;
  end: number;
  timestamp_s: number | null;
  link: string;
};

export type Flag = {
  rule_id: string;
  rule_name: string;
  legal_basis: string;
  kind: RuleKind;
  result: FlagResult;
  confidence: number;
  // Score reguły (waga * P(naruszenie)) — reguła przekracza próg, gdy score ≥ próg `flag` modułu.
  // null = brak score'u per reguła (M1, M3, starsze wyniki).
  score: number | null;
  reason: string;
  evidence: Evidence | null;
};

export type IncidentEntity = {
  firm_name: string | null;
  knf_id: number | null;
  in_register: boolean | null;
  advertiser: string | null;
  nip: string | null;
  domain: string | null;
  on_warning_list: boolean | null;
};

export type IncidentDetails = {
  summary: string;
  entity: IncidentEntity;
  flags: Flag[];
  error: string | null;
  // M3 (poza §3): kontakt do podmiotu z treści oferty i score 0-1 przesłanek doradztwa.
  contact?: { emails: string[]; phones: string[] };
  signals?: Record<string, number>;
};

// ─── §4–§10: REST i Socket.io ───────────────────────────────────────────────────────────────

// Autor decyzji (R16), także odpowiedź GET /api/me.
export type Reviewer = { id: string; name: string; role: string | null };

// Decyzja analityka przy incydencie. `reviewed_by`/`reviewed_at` = null przy statusie `new`.
export type Review = {
  status: ReviewStatus;
  reviewed_by: Reviewer | null;
  reviewed_at: string | null;
  // Powód przy „Odłożony” i „Fałszywy alarm”, np. „dowód niepełny”.
  review_note: string | null;
};

// Zdarzenie w historii incydentu (§5). `actor` = null to system (oflagowanie, alert, analiza).
export type HistoryEntry = {
  at: string;
  actor: Reviewer | null;
  action: string;
  status: ReviewStatus | null;
};

export type IncidentListItem = {
  id: string;
  module: AnalysisModule;
  score: number;
  // Priorytet do sortowania (M2: risk_score z ML; bez niego = score).
  risk_score: number;
  label: string;
  summary: string;
  firm_name: string | null;
  advertiser: string | null;
  platform: Platform;
  url: string;
  created_at: string;
  // Tytuł materiału (materials.title) i rejestr KNF z `details.entity` — nagłówki w Kolejce.
  title: string | null;
  in_register: boolean | null;
} & Review;

export type IncidentList = { items: IncidentListItem[]; total: number };

export type IncidentDetail = {
  id: string;
  module: AnalysisModule;
  score: number;
  risk_score: number;
  label: string;
  created_at: string;
  material: {
    url: string;
    platform: Platform;
    title: string | null;
    author: string | null;
    text: string;
    published_at: string | null;
    scraped_at: string;
    has_snapshot: boolean;
    // Film pobrany przez serwis media: GET /api/incidents/:id/video (mp4 z obsługą Range).
    has_video: boolean;
    // Długość filmu w sekundach (metadane YouTube), null dla stron WWW.
    duration_s: number | null;
    // SHA-256 zapisanej kopii (R4): kopii HTML, a bez niej tekstu materiału.
    content_hash: string;
  };
  details: IncidentDetails;
  // Od najnowszego: zmiany statusu z autorem, oflagowanie, alert, ponowna analiza.
  history: HistoryEntry[];
} & Review;

export type TrendPoint = { date: string } & Record<AnalysisModule, number>;
export type Trend = { points: TrendPoint[] };

export type Calibration = {
  module: AnalysisModule;
  threshold: number;
  flagged: number;
  labeled: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  // null, gdy nie da się policzyć (brak oznaczonych rekordów po danej stronie progu).
  precision: number | null;
  recall: number | null;
};

export type HighRiskIncidentEvent = {
  id: string;
  module: AnalysisModule;
  score: number;
  summary: string;
  url: string;
};

// ─── Odczyt `details` z bazy ────────────────────────────────────────────────────────────────
// `details` zapisuje pipeline analizy, więc czytamy bez zaufania do kształtu: każde pole ma
// bezpieczny fallback. Rozumiemy też stary kształt sprzed kontraktu (`explanation`,
// `entity.name`, `entity.registered`, `advertiser` na górze), żeby wcześniejsze wyniki nie znikały.

const text = z.string().trim().min(1);
const nullableText = text.nullable().catch(null);

const evidenceSchema = z.object({
  quote: z.string(),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  timestamp_s: z.number().min(0).nullable().catch(null),
  link: z.string(),
});

const flagSchema = z.object({
  rule_id: z.coerce.string(),
  rule_name: z.string().catch(""),
  legal_basis: z.string().catch(""),
  kind: z.enum(["hard", "suggestion"]).catch("hard"),
  result: z.enum(["violation", "ok", "n/a"]),
  confidence: z.number().min(0).max(1).catch(0),
  score: z.number().min(0).max(1).nullable().catch(null),
  reason: z.string().catch(""),
  evidence: evidenceSchema.nullable().catch(null),
});

const rawDetailsSchema = z.object({
  summary: text.optional().catch(undefined),
  explanation: text.optional().catch(undefined),
  advertiser: text.optional().catch(undefined),
  entity: z
    .object({
      firm_name: nullableText.optional(),
      name: nullableText.optional(),
      knf_id: z.coerce.number().int().nullable().catch(null).optional(),
      in_register: z.boolean().nullable().catch(null).optional(),
      registered: z.boolean().nullable().catch(null).optional(),
      advertiser: nullableText.optional(),
      nip: nullableText.optional(),
      domain: nullableText.optional(),
      on_warning_list: z.boolean().nullable().catch(null).optional(),
    })
    .optional()
    .catch(undefined),
  flags: z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.flatMap((item) => {
        const flag = flagSchema.safeParse(item);
        return flag.success ? [flag.data] : [];
      }),
    )
    .optional(),
  error: nullableText.optional(),
  contact: z
    .object({
      emails: z.array(z.string()).max(5).catch([]),
      phones: z.array(z.string()).max(5).catch([]),
    })
    .optional()
    .catch(undefined),
  signals: z.record(z.string(), z.number().min(0).max(1)).optional().catch(undefined),
});

export function readIncidentDetails(details: unknown): IncidentDetails {
  const parsed = rawDetailsSchema.safeParse(details);
  const raw = parsed.success ? parsed.data : {};
  const entity = raw.entity ?? {};
  return {
    summary: raw.summary ?? raw.explanation ?? "",
    entity: {
      firm_name: entity.firm_name ?? entity.name ?? null,
      knf_id: entity.knf_id ?? null,
      in_register: entity.in_register ?? entity.registered ?? null,
      advertiser: entity.advertiser ?? raw.advertiser ?? null,
      nip: entity.nip ?? null,
      domain: entity.domain ?? null,
      on_warning_list: entity.on_warning_list ?? null,
    },
    flags: raw.flags ?? [],
    error: raw.error ?? null,
    ...(raw.contact ? { contact: raw.contact } : {}),
    ...(raw.signals ? { signals: raw.signals } : {}),
  };
}
