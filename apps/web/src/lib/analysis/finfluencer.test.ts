import { describe, expect, it } from "vitest";
import type { KnfEntity, KnfWarning } from "./entity";
import {
  buildFinfluencerResult,
  type FinfluencerMaterial,
  type FirmLookup,
  isOwnChannel,
  signalQuote,
  signalScore,
} from "./finfluencer";

const XTB: KnfEntity = {
  id: 1001,
  name: "XTB S.A.",
  former_names: [],
  deleted: false,
  register_name: "Firmy inwestycyjne - Domy maklerskie",
  register_id: 19,
  investment_register: true,
  attributes: [],
  domains: ["xtb.com"],
  detail_url: "https://www.knf.gov.pl/podmioty/wyszukiwarka_podmiotow#1001",
};

const SCAM: KnfWarning = {
  category: "art. 178 ustawy o obrocie instrumentami finansowymi",
  number: 7,
  entities: "Szybki Zysk Ltd",
  identifiers: [{ kind: "NIP", value: "5260250274" }],
  prosecutor: null,
  rulings: null,
  notes: null,
  domains: ["szybki-zysk.example"],
};

const TEXT = [
  "Jak zacząć inwestować",
  "Załóż konto z mojego linku: https://bit.ly/kanal-xtb i wpisz kod KANAL50",
  "Cześć, dzisiaj o inwestowaniu. Z moim kodem dostaniesz darmowe akcje.",
].join("\n\n");

const VIDEO: FinfluencerMaterial = {
  url: "https://www.youtube.com/watch?v=AAAAAAAAAA1",
  platform: "youtube",
  author: "Kanał Testowy",
  title: "Jak zacząć inwestować",
  text: TEXT,
  metadata: {
    kind: "youtube_video",
    paid_promotion: true,
    promo_codes: ["KANAL50"],
    links: [
      { url: "https://instagram.com/kanal", domain: "instagram.com", followed: false },
      {
        url: "https://bit.ly/kanal-xtb",
        domain: "bit.ly",
        followed: true,
        final_url: "https://www.xtb.com/pl?ref=KANAL50",
        final_domain: "www.xtb.com",
      },
    ],
    transcript: {
      segments: [
        { start: 0.4, text: "Cześć, dzisiaj o inwestowaniu." },
        { start: 41.7, text: "Z moim kodem dostaniesz darmowe akcje." },
      ],
    },
  },
};

const LOOKUP: FirmLookup = { searches: [{ domain: "xtb.com", entities: [XTB] }], warnings: [SCAM] };

describe("buildFinfluencerResult", () => {
  it("film finfluencera z płatną promocją, kodem i linkiem afiliacyjnym do firmy z rejestru", () => {
    const result = buildFinfluencerResult(VIDEO, LOOKUP);
    expect(result.module).toBe("finfluencer");
    expect(result.model).toBe("rules/m1");
    expect(result.label).toBe("reklama");
    // 1 − (1 − 0,6)(1 − 0,5)(1 − 0,5)(1 − 0,3)
    expect(result.score).toBe(0.93);
    expect(result.details).toMatchObject({
      entity: {
        firm_name: "XTB S.A.",
        knf_id: 1001,
        in_register: true,
        advertiser: "Kanał Testowy",
        domain: "xtb.com",
        on_warning_list: false,
      },
      error: null,
    });
    const [flag] = (result.details as { flags: unknown[] }).flags;
    expect(flag).toMatchObject({
      rule_id: "M1.ad",
      kind: "hard",
      result: "violation",
      confidence: 0.93,
      evidence: { quote: expect.stringContaining("Załóż konto z mojego linku") },
    });
  });

  it("sam link do firmy to tylko wzmianka", () => {
    const result = buildFinfluencerResult(
      {
        ...VIDEO,
        text: "Moje portfolio trzymam na xtb.com, recenzja platformy.",
        metadata: { links: [{ url: "https://xtb.com", domain: "xtb.com" }] },
      },
      LOOKUP,
    );
    expect(result).toMatchObject({ label: "wzmianka", score: 0.3 });
  });

  it("strona WWW linkująca do podmiotu z listy ostrzeżeń KNF", () => {
    const result = buildFinfluencerResult(
      {
        url: "https://blog-o-zyskach.example/wpis",
        platform: "web",
        author: null,
        title: "Mój sposób na zysk",
        text: "Materiał sponsorowany. Zarejestruj się na szybki-zysk.example i odbierz bonus.",
        metadata: {
          kind: "web_page",
          links: [{ url: "https://szybki-zysk.example/?aff=12", domain: "szybki-zysk.example" }],
        },
      },
      { searches: [{ domain: "szybki-zysk.example", entities: [] }], warnings: [SCAM] },
    );
    expect(result.label).toBe("reklama");
    expect(result.details).toMatchObject({
      entity: {
        firm_name: "Szybki Zysk Ltd",
        in_register: false,
        on_warning_list: true,
        nip: "5260250274",
        advertiser: "blog-o-zyskach.example",
      },
    });
  });

  it("własny kanał firmy to nie podmiot trzeci", () => {
    const result = buildFinfluencerResult({ ...VIDEO, author: "XTB" }, LOOKUP);
    expect(result).toMatchObject({ label: "material_firmy", score: 0 });
  });

  it("bez firmy z KNF w linkach: score 0; KNF nie odpowiada: błąd", () => {
    expect(
      buildFinfluencerResult(VIDEO, {
        searches: [{ domain: "xtb.com", entities: [] }],
        warnings: [],
      }),
    ).toMatchObject({ label: "brak_firmy", score: 0 });
    const down = buildFinfluencerResult(VIDEO, {
      searches: [{ domain: "xtb.com", entities: null }],
      warnings: null,
    });
    expect(down).toMatchObject({ label: "blad_analizy", score: 0 });
    expect(down.details).toMatchObject({ error: "Wyszukiwarka KNF nie odpowiedziała" });
  });
});

describe("pomocnicze", () => {
  it("isOwnChannel porównuje nazwy bez form prawnych", () => {
    expect(isOwnChannel("XTB", "XTB S.A.")).toBe(true);
    expect(isOwnChannel("Dom Maklerski BOŚ", "Dom Maklerski Banku Ochrony Środowiska S.A.")).toBe(
      false,
    );
    expect(isOwnChannel("Kanał Testowy", "XTB S.A.")).toBe(false);
    expect(isOwnChannel(null, "XTB S.A.")).toBe(false);
  });

  it("signalScore liczy każdy rodzaj sygnału raz", () => {
    expect(
      signalScore([
        { kind: "ad_phrase", detail: "", at: 0 },
        { kind: "ad_phrase", detail: "", at: 5 },
      ]),
    ).toBe(0.3);
  });

  it("signalQuote bierze linię z frazą, najwyżej 300 znaków", () => {
    const text = `wstęp\n${"a".repeat(400)} z moim kodem ${"b".repeat(400)}\nkoniec`;
    const at = text.indexOf("z moim kodem");
    const quote = signalQuote(text, [{ kind: "ad_phrase", detail: "", at }]);
    expect(quote).toContain("z moim kodem");
    expect(quote?.length).toBeLessThanOrEqual(300);
    expect(signalQuote(text, [{ kind: "paid_promotion", detail: "", at: null }])).toBeNull();
  });
});
