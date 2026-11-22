import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { type IncidentEntity, readIncidentDetails } from "@/lib/incidents/contract";
import { advisoryEntity } from "./advisory";
import { type AnalyzeOutput, analyzeOutputSchema } from "./contract";
import { buildAnalysisResult } from "./details";
import { matchByName, normalizeFirmName } from "./entity";

const TEXT =
  "Kowalski Wealth Partners sp. z o.o.\nZarządzamy majątkiem naszych klientów.\nWskażemy, które akcje kupić.";

const MATERIAL = {
  url: "https://kowalski-wealth.example/",
  platform: "web" as const,
  text: TEXT,
  metadata: {},
};

const UNKNOWN: IncidentEntity = {
  firm_name: null,
  knf_id: null,
  in_register: false,
  advertiser: null,
  nip: null,
  domain: "kowalski-wealth.example",
  on_warning_list: false,
};

function output(overrides: Partial<z.input<typeof analyzeOutputSchema>> = {}): AnalyzeOutput {
  return analyzeOutputSchema.parse({
    material_id: "m1",
    label: "potencjalne_doradztwo",
    probability: 0.8,
    summary: "Prawdopodobna oferta doradztwa inwestycyjnego.",
    findings: [
      {
        rule_id: "M3.advisory",
        result: "violation",
        confidence: 0.8,
        quote: "Zarządzamy majątkiem naszych klientów.",
        reason: "Przesłanki doradztwa",
      },
      {
        rule_id: "M3.recommendation",
        result: "violation",
        confidence: 0.85,
        quote: "Wskażemy, które akcje kupić.",
        reason: "Rekomendacje",
      },
    ],
    subject: {
      name: "Kowalski Wealth Partners sp. z o.o.",
      identifiers: [{ kind: "NIP", value: "5252344078" }],
      emails: ["kontakt@kowalski-wealth.example"],
      phones: ["+48 600 123 456"],
    },
    signals: { offer: 0.85, recommendation: 0.85 },
    error: null,
    ...overrides,
  });
}

function build(
  entity: IncidentEntity,
  overrides: Partial<z.input<typeof analyzeOutputSchema>> = {},
) {
  return buildAnalysisResult("unauthorized_advisory", output(overrides), MATERIAL, entity);
}

describe("moduł 3: doradztwo i rejestr KNF", () => {
  it("podmiot spoza rejestru: score = P, flaga braku zezwolenia, dane podmiotu z treści", () => {
    const result = build(UNKNOWN);
    expect(result).toMatchObject({ score: 0.8, risk_score: 0.8, label: "potencjalne_doradztwo" });
    const details = readIncidentDetails(result.details);
    expect(details.flags.map((f) => [f.rule_id, f.result])).toEqual([
      ["M3.advisory", "violation"],
      ["M3.license", "violation"],
      ["M3.recommendation", "violation"],
    ]);
    expect(details.flags[0]?.evidence?.quote).toBe("Zarządzamy majątkiem naszych klientów.");
    expect(details.entity).toMatchObject({
      firm_name: "Kowalski Wealth Partners sp. z o.o.",
      nip: "5252344078",
    });
    expect(details.contact).toEqual({
      emails: ["kontakt@kowalski-wealth.example"],
      phones: ["+48 600 123 456"],
    });
    expect(details.signals).toEqual({ offer: 0.85, recommendation: 0.85 });
    expect(details.summary).toContain("Brak podmiotu w rejestrze KNF");
  });

  it("firma z zezwoleniem KNF: score obniżony, usługa dozwolona", () => {
    const result = build({
      ...UNKNOWN,
      firm_name: "Kowalski DM S.A.",
      knf_id: 7,
      in_register: true,
    });
    expect(result).toMatchObject({ score: 0.16, label: "usluga_dozwolona" });
    const license = readIncidentDetails(result.details).flags.find(
      (f) => f.rule_id === "M3.license",
    );
    expect(license).toMatchObject({ result: "ok" });
  });

  it("lista ostrzeżeń KNF podbija score", () => {
    const result = build(
      { ...UNKNOWN, on_warning_list: true },
      { probability: 0.4, label: "brak_przeslanek" },
    );
    // brak_przeslanek z probability 0,4 → P(doradztwo) = 0,6; 1 − 0,4 × 0,4 = 0,84.
    expect(result).toMatchObject({ score: 0.84, label: "potencjalne_doradztwo" });
  });

  it("bez przesłanek doradztwa brak zezwolenia nie jest naruszeniem", () => {
    const result = build(UNKNOWN, { label: "brak_przeslanek", probability: 0.95, findings: [] });
    expect(result.score).toBe(0.05);
    const license = readIncidentDetails(result.details).flags.find(
      (f) => f.rule_id === "M3.license",
    );
    expect(license?.result).toBe("n/a");
  });

  it("błąd modelu: score 0, bez flag", () => {
    const result = build(UNKNOWN, { error: "timeout", findings: [] });
    expect(result).toMatchObject({ score: 0, label: "blad_analizy" });
  });

  it("advisoryEntity nie nadpisuje danych z rejestru", () => {
    const entity = advisoryEntity(
      { ...UNKNOWN, firm_name: "Z rejestru S.A.", nip: "1111111111" },
      output().subject,
    );
    expect(entity).toMatchObject({ firm_name: "Z rejestru S.A.", nip: "1111111111" });
  });
});

describe("dopasowanie po nazwie w KNF", () => {
  it("normalizuje formę prawną i interpunkcję", () => {
    expect(normalizeFirmName("Kowalski Wealth Partners sp. z o.o.")).toBe("kowalskiwealthpartners");
    expect(
      normalizeFirmName("KOWALSKI WEALTH PARTNERS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"),
    ).toBe("kowalskiwealthpartners");
  });

  it("wybiera wpis o tej samej nazwie, z rejestru inwestycyjnego", () => {
    const entity = (id: number, name: string, investment: boolean) => ({
      id,
      name,
      former_names: [],
      deleted: false,
      register_name: investment ? "Firmy inwestycyjne - Domy maklerskie" : "Agenci",
      register_id: null,
      investment_register: investment,
      attributes: [],
      domains: [],
      detail_url: "",
    });
    const found = matchByName(
      [entity(1, "Kowalski Wealth", false), entity(2, "KOWALSKI WEALTH PARTNERS S.A.", true)],
      "Kowalski Wealth Partners sp. z o.o.",
    );
    expect(found?.id).toBe(2);
    expect(
      matchByName([entity(1, "Inna Firma S.A.", true)], "Kowalski Wealth Partners"),
    ).toBeNull();
  });
});

describe("wyjście ML z polami M3", () => {
  it("odpowiedź M2 z `model: null`, `subject: null` i pustymi `signals` jest zgodna z kontraktem", () => {
    const parsed = analyzeOutputSchema.safeParse({
      material_id: "m1",
      label: null,
      probability: null,
      summary: "",
      findings: [],
      risk_score: 0.1,
      max_rule_score: 0.1,
      rule_scores: {},
      subject: null,
      signals: {},
      model: null,
      error: null,
    });
    expect(parsed.success).toBe(true);
  });
});
