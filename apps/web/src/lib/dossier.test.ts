import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildDossier, dossierFileName, entityNameOf } from "./dossier";
import type { IncidentDetail } from "./incidents/contract";

const marta = { id: "m", name: "Marta Kowalska", role: "analityczka" };

function incident(overrides: Partial<IncidentDetail> = {}): IncidentDetail {
  return {
    id: "r1",
    module: "risk_disclosure",
    score: 0.84,
    risk_score: 0.84,
    label: "naruszenie",
    created_at: "2026-11-21T20:00:00.000Z",
    status: "confirmed",
    reviewed_by: marta,
    reviewed_at: "2026-11-21T21:00:00.000Z",
    review_note: null,
    material: {
      url: "https://www.przyklad.pl/oferta",
      platform: "web",
      title: "Oferta",
      author: null,
      text: "Zarabiaj 20% miesięcznie bez ryzyka.",
      published_at: null,
      scraped_at: "2026-11-21T19:00:00.000Z",
      has_snapshot: true,
      has_video: false,
      duration_s: null,
      content_hash: "ab".repeat(32),
    },
    details: {
      summary: "Brak informacji o ryzyku",
      entity: {
        firm_name: "Żółta Inwestycja S.A.",
        knf_id: null,
        in_register: false,
        advertiser: null,
        nip: null,
        domain: null,
        on_warning_list: null,
      },
      flags: [
        {
          rule_id: "3",
          rule_name: "Brak ostrzeżenia o ryzyku",
          legal_basis: "",
          kind: "hard",
          result: "violation",
          confidence: 0.9,
          score: 0.9,
          reason: "",
          evidence: { quote: "bez ryzyka", start: 25, end: 35, timestamp_s: null, link: "" },
        },
      ],
      error: null,
    },
    history: [],
    ...overrides,
  };
}

describe("entityNameOf", () => {
  it("firma z rejestru, a bez niej reklamodawca — jak w Kolejce", () => {
    const details = incident().details;
    expect(entityNameOf(details)).toBe("Żółta Inwestycja S.A.");
    expect(
      entityNameOf({
        ...details,
        entity: { ...details.entity, firm_name: null, advertiser: "Jan" },
      }),
    ).toBe("Jan");
  });
});

describe("buildDossier", () => {
  it("katalog na materiał z kopią, tekstem i wynikami modułów", () => {
    const generatedAt = new Date("2026-11-22T08:00:00.000Z");
    const zip = buildDossier({
      firm: "Żółta Inwestycja S.A.",
      generatedAt,
      generatedBy: marta,
      cases: [
        {
          incidents: [incident(), incident({ id: "r2", module: "unauthorized_advisory" })],
          snapshot: "<html>kopia</html>",
        },
        { incidents: [incident({ id: "r3" })], snapshot: null },
      ],
    });
    const files = unzipSync(zip);
    // Wpisy katalogów („01-przyklad-pl/”) pomijamy — liczą się pliki.
    expect(
      Object.keys(files)
        .filter((name) => !name.endsWith("/"))
        .sort(),
    ).toEqual([
      "01-przyklad-pl/kopia.html",
      "01-przyklad-pl/material.json",
      "01-przyklad-pl/tekst.txt",
      "02-przyklad-pl/material.json",
      "02-przyklad-pl/tekst.txt",
      "spis.txt",
      "teczka.json",
    ]);
    const read = (name: string) => strFromU8(files[name] ?? new Uint8Array());
    expect(read("01-przyklad-pl/kopia.html")).toBe("<html>kopia</html>");
    expect(read("01-przyklad-pl/tekst.txt")).toBe("Zarabiaj 20% miesięcznie bez ryzyka.");
    const material = JSON.parse(read("01-przyklad-pl/material.json"));
    expect(material.material.text).toBeUndefined();
    expect(material.incidents.map((item: { id: string }) => item.id)).toEqual(["r1", "r2"]);
    expect(read("spis.txt")).toContain("Teczka podmiotu: Żółta Inwestycja S.A.");
    expect(read("spis.txt")).toContain("Potwierdzone incydenty: 3 w 2 materiałach");
    expect(read("spis.txt")).toContain("- Brak ostrzeżenia o ryzyku: „bez ryzyka”");
    expect(JSON.parse(read("teczka.json")).generated_by).toEqual(marta);
  });

  it("nazwa pliku bez polskich znaków i spacji", () => {
    expect(dossierFileName("Żółta Inwestycja S.A.", new Date("2026-11-22T08:00:00.000Z"))).toBe(
      "teczka-zolta-inwestycja-s-a-2026-11-22.zip",
    );
  });
});
