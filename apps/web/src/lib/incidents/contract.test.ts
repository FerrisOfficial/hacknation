import { describe, expect, it } from "vitest";
import { incidentsQuerySchema, thresholdSettingsUpdateSchema } from "@/lib/schemas";
import { readIncidentDetails } from "./contract";

describe("readIncidentDetails", () => {
  it("czyta kształt z kontraktu (§3)", () => {
    const details = readIncidentDetails({
      summary: "Reklama CFD bez ostrzeżenia",
      entity: {
        firm_name: "XTB S.A.",
        knf_id: 123,
        in_register: true,
        advertiser: null,
        nip: "5272363024",
        domain: "xtb.com",
        on_warning_list: false,
      },
      flags: [
        {
          rule_id: "3",
          rule_name: "Ostrzeżenie o ryzyku",
          legal_basis: "art. 44 rozp. 2017/565",
          kind: "hard",
          result: "violation",
          confidence: 0.8,
          reason: "Brak ostrzeżenia",
          evidence: { quote: "zysk 20%", start: 10, end: 18, timestamp_s: null, link: "https://x" },
        },
      ],
      error: null,
    });
    expect(details.summary).toBe("Reklama CFD bez ostrzeżenia");
    expect(details.entity).toEqual({
      firm_name: "XTB S.A.",
      knf_id: 123,
      in_register: true,
      advertiser: null,
      nip: "5272363024",
      domain: "xtb.com",
      on_warning_list: false,
    });
    expect(details.flags).toHaveLength(1);
    expect(details.flags[0]?.evidence?.start).toBe(10);
    // Flaga zapisana przed score'ami per reguła: score = null.
    expect(details.flags[0]?.score).toBeNull();
  });

  it("czyta score reguły z flagi", () => {
    const details = readIncidentDetails({
      flags: [{ rule_id: "3", result: "violation", confidence: 0.9, score: 0.87 }],
    });
    expect(details.flags[0]?.score).toBe(0.87);
  });

  it("rozumie stary kształt sprzed kontraktu", () => {
    const details = readIncidentDetails({
      explanation: "Finfluencer poleca brokera",
      advertiser: "Jan Inwestor",
      entity: { name: "XTB S.A.", knf_id: "123", registered: true },
      phrases: ["kod polecający"],
    });
    expect(details.summary).toBe("Finfluencer poleca brokera");
    expect(details.entity.firm_name).toBe("XTB S.A.");
    expect(details.entity.knf_id).toBe(123);
    expect(details.entity.in_register).toBe(true);
    expect(details.entity.advertiser).toBe("Jan Inwestor");
    expect(details.flags).toEqual([]);
  });

  it("odrzuca zepsute flagi i nie wywraca się na śmieciach", () => {
    expect(readIncidentDetails(null)).toEqual({
      summary: "",
      entity: {
        firm_name: null,
        knf_id: null,
        in_register: null,
        advertiser: null,
        nip: null,
        domain: null,
        on_warning_list: null,
      },
      flags: [],
      error: null,
    });
    const details = readIncidentDetails({
      flags: [{ rule_id: "1" }, { rule_id: 2, result: "ok", evidence: { quote: 1 } }],
    });
    expect(details.flags).toHaveLength(1);
    expect(details.flags[0]).toMatchObject({ rule_id: "2", result: "ok", evidence: null });
  });
});

describe("thresholdSettingsUpdateSchema", () => {
  it("przyjmuje część modułów i zaokrągla do setnych", () => {
    expect(
      thresholdSettingsUpdateSchema.parse({ finfluencer: { flag: 0.555, alert: 0.9 } }),
    ).toEqual({ finfluencer: { flag: 0.56, alert: 0.9 } });
  });

  it("odrzuca alert niższy niż flag, pusty obiekt i nieznany moduł", () => {
    expect(
      thresholdSettingsUpdateSchema.safeParse({ finfluencer: { flag: 0.8, alert: 0.5 } }).success,
    ).toBe(false);
    expect(thresholdSettingsUpdateSchema.safeParse({}).success).toBe(false);
    expect(thresholdSettingsUpdateSchema.safeParse({ m4: { flag: 0.5, alert: 0.9 } }).success).toBe(
      false,
    );
  });
});

describe("incidentsQuerySchema", () => {
  it("parametry z kontraktu i listy po przecinku", () => {
    expect(
      incidentsQuerySchema.parse({
        module: "risk_disclosure",
        platform: "web,youtube",
        status: "new",
        min_score: "0.7",
        page: "2",
      }),
    ).toMatchObject({
      module: ["risk_disclosure"],
      platform: ["web", "youtube"],
      status: ["new"],
      min_score: 0.7,
      page: 2,
      page_size: 25,
      sort: "risk",
    });
    expect(incidentsQuerySchema.parse({ sort: "date" }).sort).toBe("date");
    expect(incidentsQuerySchema.safeParse({ sort: "score" }).success).toBe(false);
  });
});
