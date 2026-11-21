import type { AnalysisModule } from "@app/db";
import { readDetails } from "@/lib/analysis/contract";
import { type RiskLevel, riskLevel } from "@/lib/analysis/modules";
import { readIncidentDetails } from "@/lib/incidents/contract";

// Raporty modułów (rezultaty z zadania UKNF), czyste mapowanie bez bazy:
// M1 — firma inwestycyjna, reklamujący, treść reklamy, URL;
// M2 — firma, niespełnione wymogi informacji o ryzyku, URL;
// M3 — podmiot, treść oferty, frazy wskazujące na doradztwo, URL.

export type ReportSource = {
  resultId: string;
  module: AnalysisModule;
  score: number;
  label: string;
  model: string;
  status: string;
  reviewNote: string | null;
  details: Record<string, unknown>;
  detectedAt: Date;
  updatedAt: Date;
  url: string;
  platform: string;
  title: string | null;
  author: string | null;
  text: string;
  publishedAt: Date | null;
  metadata: Record<string, unknown>;
  sourceName: string | null;
};

export type ReportRow = {
  wykryto: string;
  zaktualizowano: string;
  modul: AnalysisModule;
  ryzyko: RiskLevel;
  score: number;
  etykieta: string;
  status: string;
  podmiot: string;
  podmiot_knf: string;
  reklamujacy: string;
  platforma: string;
  zrodlo: string;
  url: string;
  tytul: string;
  opublikowano: string;
  tresc: string;
  frazy: string;
  braki_informacji_o_ryzyku: string;
  kody_promocyjne: string;
  platna_promocja: string;
  uzasadnienie: string;
  model: string;
  notatka: string;
};

const MAX_TEXT = 2_000;

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function reportRow(source: ReportSource, threshold: number): ReportRow {
  // Kształt z docs/KONTRAKT.md §3; `legacy` — stare klucze sprzed kontraktu.
  const details = readIncidentDetails(source.details);
  const legacy = readDetails(source.details);
  const entity = details.entity;
  const registerName = legacy.entity?.register_name;
  const knf = [
    entity.in_register === null
      ? ""
      : `${entity.in_register ? "w rejestrze KNF" : "brak w rejestrze KNF"}${
          entity.knf_id !== null ? ` (id ${entity.knf_id})` : ""
        }${registerName ? `: ${registerName}` : ""}`,
    entity.on_warning_list ? "na liście ostrzeżeń KNF" : "",
  ]
    .filter(Boolean)
    .join("; ");
  const violations = details.flags.filter((flag) => flag.result === "violation");
  const quotes = violations.flatMap((flag) => (flag.evidence ? [flag.evidence.quote] : []));
  const missing =
    source.module === "risk_disclosure"
      ? violations.map((flag) => `${flag.rule_id}. ${flag.rule_name}`)
      : [];
  const paid = source.metadata.paid_promotion;
  return {
    wykryto: source.detectedAt.toISOString(),
    zaktualizowano: source.updatedAt.toISOString(),
    modul: source.module,
    ryzyko: riskLevel(source.score, threshold),
    score: Math.round(source.score * 1000) / 1000,
    etykieta: source.label,
    status: source.status,
    // M3: podmiot doradczy to zwykle autor strony, jeśli model nie wskazał innego.
    podmiot: entity.firm_name ?? (source.module === "finfluencer" ? "" : (source.author ?? "")),
    podmiot_knf: knf,
    reklamujacy:
      entity.advertiser ?? (source.module === "finfluencer" ? (source.author ?? "") : ""),
    platforma: source.platform,
    zrodlo: source.sourceName ?? "",
    url: source.url,
    tytul: source.title ?? "",
    opublikowano: source.publishedAt?.toISOString() ?? "",
    tresc: source.text.length > MAX_TEXT ? `${source.text.slice(0, MAX_TEXT)}…` : source.text,
    frazy: (quotes.length > 0 ? quotes : (legacy.phrases ?? [])).join(" | "),
    braki_informacji_o_ryzyku: (missing.length > 0
      ? missing
      : (legacy.missing_requirements ?? [])
    ).join(" | "),
    kody_promocyjne: stringList(source.metadata.promo_codes).join(" "),
    platna_promocja: typeof paid === "boolean" ? (paid ? "tak" : "nie") : "",
    uzasadnienie: details.summary,
    model: source.model,
    notatka: source.reviewNote ?? "",
  };
}

// CSV pod Excela w polskich ustawieniach: separator `;`, BOM dla UTF-8, CRLF. Komórki zaczynające
// się od = + - @ (i tab/CR) dostają apostrof — treść z internetu nie może stać się formułą
// (CSV injection).
function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly ReportRow[]): string {
  const header: (keyof ReportRow)[] = [
    "wykryto",
    "zaktualizowano",
    "modul",
    "ryzyko",
    "score",
    "etykieta",
    "status",
    "podmiot",
    "podmiot_knf",
    "reklamujacy",
    "platforma",
    "zrodlo",
    "url",
    "tytul",
    "opublikowano",
    "tresc",
    "frazy",
    "braki_informacji_o_ryzyku",
    "kody_promocyjne",
    "platna_promocja",
    "uzasadnienie",
    "model",
    "notatka",
  ];
  const lines = [
    header.join(";"),
    ...rows.map((row) => header.map((key) => csvCell(row[key])).join(";")),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
