import { describe, expect, it } from "vitest";
import { type ReportSource, reportRow, toCsv } from "./reports";

const SOURCE: ReportSource = {
  resultId: "r1",
  module: "finfluencer",
  score: 0.8123,
  label: "reklama_firmy_inwestycyjnej",
  model: "gemma4:e2b",
  status: "new",
  reviewNote: null,
  details: {
    entity: { name: "XTB S.A.", knf_id: 123, registered: true, register_name: "Domy maklerskie" },
    phrases: ["kod promocyjny", "otwórz rachunek"],
    explanation: "Film z kodem polecającym do XTB.",
  },
  detectedAt: new Date("2026-11-21T10:00:00Z"),
  updatedAt: new Date("2026-11-21T11:00:00Z"),
  url: "https://www.youtube.com/watch?v=AAAAAAAAAA1",
  platform: "youtube",
  title: "Jak zacząć inwestować; poradnik",
  author: "Kanał Testowy",
  text: '=HYPERLINK("http://zlo.example") zarabiaj "20%"',
  publishedAt: null,
  metadata: { paid_promotion: true, promo_codes: ["KANAL50"] },
  sourceName: "YouTube: „XTB kod”",
};

describe("reportRow", () => {
  it("M1: firma z details.entity, reklamujący = autor materiału", () => {
    const row = reportRow(SOURCE, 0.5);
    expect(row.podmiot).toBe("XTB S.A.");
    expect(row.podmiot_knf).toBe("w rejestrze KNF (id 123): Domy maklerskie");
    expect(row.reklamujacy).toBe("Kanał Testowy");
    expect(row.ryzyko).toBe("high");
    expect(row.score).toBe(0.812);
    expect(row.kody_promocyjne).toBe("KANAL50");
    expect(row.platna_promocja).toBe("tak");
    expect(row.frazy).toBe("kod promocyjny | otwórz rachunek");
  });

  it("M3: bez entity podmiotem jest autor strony", () => {
    const row = reportRow({ ...SOURCE, module: "unauthorized_advisory", details: {} }, 0.5);
    expect(row.podmiot).toBe("Kanał Testowy");
    expect(row.reklamujacy).toBe("");
    expect(row.podmiot_knf).toBe("");
  });

  it("ignoruje details w złym kształcie (pisze je model)", () => {
    const row = reportRow({ ...SOURCE, details: { entity: "XTB", phrases: "nie lista" } }, 0.5);
    expect(row.podmiot).toBe("");
    expect(row.frazy).toBe("");
  });
});

describe("toCsv", () => {
  it("BOM, separator ;, cudzysłowy i ochrona przed formułami", () => {
    const csv = toCsv([reportRow(SOURCE, 0.5)]);
    expect(csv.startsWith("﻿wykryto;zaktualizowano;modul;")).toBe(true);
    expect(csv).toContain('"Jak zacząć inwestować; poradnik"');
    expect(csv).toContain(`"'=HYPERLINK(""http://zlo.example"") zarabiaj ""20%"""`);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
  });
});
