import { describe, expect, it } from "vitest";
import { brandOfDomain } from "./brands";
import type { KnfEntity, KnfWarning } from "./entity";
import {
  buildFinfluencerResult,
  type FinfluencerMaterial,
  type FirmLookup,
  isBrandChannel,
  isOwnChannel,
  isPolish,
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
  language: "pl",
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
        language: "pl",
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

  it("link na subdomenę firmy (akcje.xtb.com) trafia do XTB szukanego jako xtb.com", () => {
    const result = buildFinfluencerResult(
      {
        ...VIDEO,
        metadata: { links: [{ url: "https://akcje.xtb.com/kanal", domain: "akcje.xtb.com" }] },
      },
      LOOKUP,
    );
    expect(result.details).toMatchObject({
      entity: { firm_name: "XTB S.A.", domain: "akcje.xtb.com", in_register: true },
    });
  });

  it("firma bez domeny w KNF, znaleziona po marce z domeny (trading212.com)", () => {
    const t212: KnfEntity = {
      ...XTB,
      id: 2002,
      name: "Trading 212 Markets Ltd",
      register_name: "Notyfikacje zagranicznych firm inwestycyjnych",
      domains: [],
    };
    const result = buildFinfluencerResult(
      {
        ...VIDEO,
        metadata: {
          paid_promotion: true,
          links: [{ url: "https://trading212.com/invite/ABC", domain: "trading212.com" }],
        },
      },
      { searches: [{ domain: "trading212.com", entities: [t212] }], warnings: [] },
    );
    expect(result.details).toMatchObject({
      entity: { firm_name: "Trading 212 Markets Ltd", in_register: true },
    });
  });

  it("cytat z frazy przy reklamowanej firmie, gdy sponsorów jest kilku", () => {
    const text =
      "Partnerem odcinka jest Catering Dieta.\nPartnerem materiału jest XTB, link w opisie.";
    const result = buildFinfluencerResult(
      { ...VIDEO, text, metadata: { links: VIDEO.metadata.links } },
      LOOKUP,
    );
    const [flag] = (result.details as { flags: { evidence: { quote: string } | null }[] }).flags;
    expect(flag?.evidence?.quote).toContain("XTB");
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

// Wpisy jak w wyszukiwarce KNF (21.11.2026): domenę ma tylko jeden wpis marki albo żaden.
function knfEntity(
  id: number,
  name: string,
  register_name: string,
  domains: string[] = [],
  investment_register = true,
): KnfEntity {
  return { ...XTB, id, name, register_name, domains, investment_register };
}

const NOTIFIED = "Notyfikacje zagranicznych firm inwestycyjnych na terytorium RP";
const BANK_BROKERAGE = "Firmy inwestycyjne - Banki prowadzące działalność maklerską";
const XTB_LTD = knfEntity(1002, "XTB Ltd", NOTIFIED, ["xtb.com"]);
const XTB_SA = knfEntity(1004, "XTB S.A.", "Firmy inwestycyjne - Domy maklerskie");
const XTB_SA_EEA = knfEntity(
  1003,
  "XTB S.A.",
  "Notyfikacje krajowych domów maklerskich na terytoriach państw należących do EOG",
);
const MBANK = knfEntity(3001, "mBank S.A.", "Banki w formie spółek akcyjnych", ["mbank.pl"], false);
const MBANK_BM = knfEntity(3002, "mBANK S.A.\nBiuro Maklerskie mBank", BANK_BROKERAGE);
const PKO_BM = knfEntity(
  6001,
  "POWSZECHNA KASA OSZCZĘDNOŚCI BANK POLSKI S.A. (PKO BP S.A.)\nBiuro Maklerskie PKO Banku Polskiego",
  BANK_BROKERAGE,
);
const REVOLUT = knfEntity(4001, "Revolut Securities Europe UAB", NOTIFIED);
const IBKR = knfEntity(5001, "Interactive Brokers Ireland Ltd", NOTIFIED);

describe("firma po marce z domeny linku", () => {
  const withLink = (text: string, link: Record<string, unknown>): FinfluencerMaterial => ({
    ...VIDEO,
    text,
    metadata: { links: [link] },
  });

  it("xtb.com to polski dom maklerski XTB S.A., nie XTB Ltd z notyfikacji", () => {
    const result = buildFinfluencerResult(VIDEO, {
      searches: [{ domain: "xtb.com", entities: [XTB_LTD] }],
      warnings: [],
      brands: [{ id: "xtb", entities: [XTB_LTD, XTB_SA_EEA, XTB_SA] }],
    });
    expect(result).toMatchObject({ label: "reklama", score: 0.93 });
    expect(result.details).toMatchObject({
      entity: { firm_name: "XTB S.A.", knf_id: 1004, in_register: true, domain: "xtb.com" },
    });
  });

  const MBANK_LINK = { url: "https://www.mbank.pl/emakler/?ref=KANAL", domain: "www.mbank.pl" };
  const MBANK_LOOKUP: FirmLookup = {
    searches: [{ domain: "mbank.pl", entities: [MBANK] }],
    warnings: [],
    brands: [{ id: "mbank", entities: [MBANK, MBANK_BM] }],
  };

  it("link do banku w tekście o inwestowaniu: biuro maklerskie banku", () => {
    const result = buildFinfluencerResult(
      withLink(
        "Otwórz rachunek maklerski w mBanku z mojego linku i kup pierwsze ETF-y.",
        MBANK_LINK,
      ),
      MBANK_LOOKUP,
    );
    // 1 − (1 − 0,5)(1 − 0,3) — link afiliacyjny i fraza
    expect(result).toMatchObject({ label: "reklama", score: 0.65 });
    expect(result.details).toMatchObject({
      entity: {
        firm_name: "mBANK S.A. Biuro Maklerskie mBank",
        knf_id: 3002,
        in_register: true,
        domain: "mbank.pl",
      },
    });
  });

  it("link do banku bez słów o inwestowaniu (konto osobiste) to nie reklama firmy inwestycyjnej", () => {
    expect(
      buildFinfluencerResult(
        withLink("Załóż konto osobiste w mBanku z moim kodem i odbierz 300 zł premii.", MBANK_LINK),
        MBANK_LOOKUP,
      ),
    ).toMatchObject({ label: "brak_firmy", score: 0 });
  });

  it("Revolut: polecenie konta pomijamy, polecenie inwestowania to Revolut Securities", () => {
    const link = { url: "https://revolut.com/referral/kanal", domain: "revolut.com" };
    const lookup: FirmLookup = {
      searches: [{ domain: "revolut.com", entities: [] }],
      warnings: [],
      brands: [{ id: "revolut", entities: [REVOLUT] }],
    };
    expect(
      buildFinfluencerResult(
        withLink("Revolut: załóż konto z mojego linku i odbierz bonus na start.", link),
        lookup,
      ),
    ).toMatchObject({ label: "brak_firmy", score: 0 });
    const investing = buildFinfluencerResult(
      withLink("W Revolut kupisz akcje i ETF bez prowizji, załóż konto z mojego linku.", link),
      lookup,
    );
    // 1 − (1 − 0,3)(1 − 0,3) — zwykły link i fraza
    expect(investing).toMatchObject({ label: "reklama", score: 0.51 });
    expect(investing.details).toMatchObject({
      entity: { firm_name: "Revolut Securities Europe UAB", in_register: true },
    });
  });

  it("Interactive Brokers: KNF nie zna domeny, firma z marki, waga linku zostaje", () => {
    const result = buildFinfluencerResult(
      withLink("Konto w Interactive Brokers założysz z mojego linku.", {
        url: "https://ibkr.com/referral/kanal",
        domain: "ibkr.com",
        followed: true,
        final_url: "https://www.interactivebrokers.ie/pl/home.php",
        final_domain: "www.interactivebrokers.ie",
      }),
      {
        searches: [{ domain: "interactivebrokers.ie", entities: [] }],
        warnings: [],
        brands: [{ id: "ibkr", entities: [IBKR] }],
      },
    );
    // 1 − (1 − 0,5)(1 − 0,3) — link afiliacyjny (przekierowanie) i fraza
    expect(result).toMatchObject({ label: "reklama", score: 0.65 });
    expect(result.details).toMatchObject({
      entity: { firm_name: "Interactive Brokers Ireland Ltd", domain: "interactivebrokers.ie" },
    });
  });

  it("kanał i strona pod marką banku to materiał firmy", () => {
    const pko = buildFinfluencerResult(
      {
        ...withLink("Rachunek maklerski i IKE w PKO BP — załóż konto.", {
          url: "https://www.pkobp.pl/inwestycje/",
          domain: "www.pkobp.pl",
        }),
        author: "PKO Bank Polski",
      },
      {
        searches: [{ domain: "pkobp.pl", entities: [] }],
        warnings: [],
        brands: [{ id: "pkobp", entities: [PKO_BM] }],
      },
    );
    expect(pko).toMatchObject({ label: "material_firmy", score: 0 });

    const page = buildFinfluencerResult(
      {
        url: "https://www.mbank.pl/indywidualny/inwestycje/emakler/",
        platform: "web",
        language: "pl",
        author: null,
        title: "eMakler",
        text: "eMakler w mBanku: rachunek maklerski bez opłat za prowadzenie. Załóż konto.",
        metadata: { kind: "web_page", links: [] },
      },
      MBANK_LOOKUP,
    );
    expect(page).toMatchObject({ label: "material_firmy", score: 0 });
  });

  it("marka z linku bez odpowiedzi KNF: błąd analizy, nie brak firmy", () => {
    expect(
      buildFinfluencerResult(
        withLink("W Revolut kupisz akcje i ETF, załóż konto z mojego linku.", {
          url: "https://revolut.com/referral/kanal",
          domain: "revolut.com",
        }),
        {
          searches: [{ domain: "revolut.com", entities: [] }],
          warnings: [],
          brands: [{ id: "revolut", entities: null }],
        },
      ),
    ).toMatchObject({ label: "blad_analizy", score: 0 });
  });
});

describe("kody polecające z tekstu", () => {
  const codeOf = (text: string) => {
    const result = buildFinfluencerResult(
      { ...VIDEO, text, metadata: { links: VIDEO.metadata.links } },
      LOOKUP,
    );
    return (result.details as { flags: { reason: string }[] }).flags[0]?.reason ?? "";
  };

  it("kod po słowie polecającym, po dwukropku albo z cyfrą, bez ucinania końcówki", () => {
    expect(codeOf("Wpisz kod polecający DETERMINACJA przy rejestracji")).toContain(
      "kod DETERMINACJA;",
    );
    expect(codeOf("Z kodem promocyjnym XTB2024 dostaniesz akcje")).toContain("kod XTB2024");
    expect(codeOf("Kod: ZGRZYT")).toContain("kod ZGRZYT;");
    expect(codeOf("Wpisz kod KANAL50")).toContain("kod KANAL50;");
  });

  it("nie bierze skrótów ani zwykłych wielkich słów za kod", () => {
    expect(codeOf("Jak znaleźć ETF po kodzie ISIN")).not.toContain("kod ");
    expect(codeOf("Wpisz kod DETERMINACJA przy rejestracji")).not.toContain("kod ");
    expect(codeOf("Kod źródłowy aplikacji jest na GitHubie")).not.toContain("kod ");
  });

  it("„link partnerski” to fraza reklamowa", () => {
    expect(codeOf("Po kliknięciu w nasz link partnerski trafisz na stronę XTB")).toContain(
      "„link partnerski”",
    );
  });
});

describe("język i wzmianka marki", () => {
  it("materiał nie po polsku jest poza zakresem M1", () => {
    const result = buildFinfluencerResult({ ...VIDEO, language: "en" }, LOOKUP);
    expect(result).toMatchObject({ label: "inny_jezyk", score: 0 });
    expect(
      isPolish({ language: null, text: "How to buy gold on Trading 212 and what you should know" }),
    ).toBe(false);
    expect(
      isPolish({ language: null, text: "Jak kupić złoto w XTB i na co uważać, to jest proste" }),
    ).toBe(true);
  });

  it("firma po nazwie w tekście, bez linku: sygnał wzmianki marki", () => {
    const material: FinfluencerMaterial = {
      ...VIDEO,
      text: "Od roku inwestuję w XTB. Z moim kodem dostaniesz darmowe akcje, polecam XTB.",
      metadata: { paid_promotion: false, links: [] },
    };
    const lookup: FirmLookup = {
      searches: [],
      warnings: [],
      brands: [{ id: "xtb", entities: [XTB] }],
    };
    const result = buildFinfluencerResult(material, lookup);
    // 1 − (1 − 0,2)(1 − 0,3) — wzmianka marki i fraza
    expect(result).toMatchObject({ score: 0.44, label: "wzmianka" });
    expect(result.details).toMatchObject({
      entity: { firm_name: "XTB S.A.", in_register: true, domain: null },
    });
    const [flag] = (result.details as { flags: { reason: string }[] }).flags;
    expect(flag?.reason).toContain("nazwa XTB w tekście (2×), bez linku");
  });

  it("marka bez potwierdzenia w KNF nie przechodzi bramki", () => {
    const material: FinfluencerMaterial = { ...VIDEO, text: "Polecam XTB.", metadata: {} };
    expect(
      buildFinfluencerResult(material, {
        searches: [],
        warnings: [],
        brands: [{ id: "xtb", entities: [] }],
      }),
    ).toMatchObject({ label: "brak_firmy", score: 0 });
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

  it("isBrandChannel: nazwa kanału równa marce albo jej aliasowi, nie zawarta w niej", () => {
    const ing = brandOfDomain("ing.pl");
    expect(isBrandChannel("ING", ing)).toBe(true);
    expect(isBrandChannel("Investing PL", ing)).toBe(false);
    expect(isBrandChannel("PKO Bank Polski", brandOfDomain("pkobp.pl"))).toBe(true);
    expect(isBrandChannel("Kanał Testowy", brandOfDomain("pkobp.pl"))).toBe(false);
    expect(isBrandChannel("ING", null)).toBe(false);
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

  it("signalQuote w długiej transkrypcji zaczyna od początku zdania, kończy na słowie", () => {
    const filler = "To jest zdanie wypełniające o inwestowaniu w fundusze ETF. ".repeat(6);
    const text = `${filler}Po kliknięciu w nasz link partnerski trafisz na stronę dedykowaną IKE w XTB. ${filler}`;
    const at = text.indexOf("link partnerski");
    const quote = signalQuote(text, [{ kind: "ad_phrase", detail: "", at }]) ?? "";
    expect(quote.startsWith("Po kliknięciu w nasz link partnerski")).toBe(true);
    expect(quote.length).toBeLessThanOrEqual(300);
    expect(text.includes(quote)).toBe(true);
    expect(quote).toMatch(/[.!?…]$|\p{L}$/u);
  });
});
