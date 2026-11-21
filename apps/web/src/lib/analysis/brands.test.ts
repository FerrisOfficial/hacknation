import { describe, expect, it } from "vitest";
import {
  BRANDS,
  brandOfDomain,
  hasInvestmentContext,
  m1SearchQueries,
  matchBrandEntity,
  mentionedBrands,
} from "./brands";
import { type KnfEntity, registerRank } from "./entity";

const ENTITY: KnfEntity = {
  id: 1,
  name: "Trading 212 Markets Ltd",
  former_names: [],
  deleted: false,
  register_name: "Notyfikacje zagranicznych firm inwestycyjnych",
  register_id: null,
  investment_register: true,
  attributes: [],
  domains: [],
  detail_url: "https://www.knf.gov.pl/#1",
};

describe("marki M1", () => {
  it("frazy: każda marka × jej szablony, unikalne; banki tylko oferta maklerska", () => {
    const queries = m1SearchQueries();
    expect(queries).toHaveLength(BRANDS.reduce((n, b) => n + b.queries.length, 0));
    expect(new Set(queries).size).toBe(queries.length);
    expect(queries).toContain("XTB kod");
    expect(queries).toContain("Trading 212 jak założyć konto");
    expect(queries).toContain("mBank rachunek maklerski");
    expect(queries).not.toContain("mBank kod");
    expect(queries).not.toContain("Revolut kod");
  });

  it("domena z linku → marka (subdomeny, końcówki dwuczłonowe)", () => {
    expect(brandOfDomain("akcje.xtb.com")?.id).toBe("xtb");
    expect(brandOfDomain("bm.pekao.com.pl")?.id).toBe("pekao");
    expect(brandOfDomain("www.interactivebrokers.co.uk")?.id).toBe("ibkr");
    expect(brandOfDomain("scalable.capital")?.id).toBe("scalable");
    expect(brandOfDomain("blog-o-zyskach.example")).toBeNull();
    expect(new Set(BRANDS.flatMap((b) => b.domains)).size).toBe(
      BRANDS.flatMap((b) => b.domains).length,
    );
  });

  it("kontekst inwestycyjny: rachunek maklerski, ETF, IKE — nie konto osobiste", () => {
    expect(hasInvestmentContext("Otwórz rachunek maklerski i kup ETF-y")).toBe(true);
    expect(hasInvestmentContext("eMakler w mBanku")).toBe(true);
    expect(hasInvestmentContext("Wpłać na IKE przed końcem roku")).toBe(true);
    expect(hasInvestmentContext("Inwestowanie dla początkujących")).toBe(true);
    expect(hasInvestmentContext("Załóż konto osobiste i odbierz 300 zł premii")).toBe(false);
    expect(hasInvestmentContext("Akcja promocyjna: karta bez opłat, bike i lajki")).toBe(false);
  });

  it("krótkie aliasy banków tylko jako całe słowa", () => {
    expect(mentionedBrands("Investing i trading bez prowizji")).toEqual([]);
    expect(mentionedBrands("Rachunek maklerski w ING i w mBanku")[0]?.brand.id).toBe("ing");
    expect(mentionedBrands("Konto w mBanku")[0]?.brand.id).toBe("mbank");
  });

  it("wzmianki: całe słowa, bez wielkości liter, od najczęstszej", () => {
    const mentions = mentionedBrands(
      "Porównuję eToro i XTB. W xtb mam konto, eToro odpuściłem? XTBX nie",
    );
    // Remis (po 2) — wygrywa wcześniejsza wzmianka.
    expect(mentions.map((m) => [m.brand.id, m.count])).toEqual([
      ["etoro", 2],
      ["xtb", 2],
    ]);
    expect(mentionedBrands("XTB, XTB i jeszcze raz XTB, a raz eToro")[0]?.brand.id).toBe("xtb");
    expect(mentionedBrands("trading212 i Trading 212")[0]?.count).toBe(2);
    expect(mentionedBrands("lynxowy kolor")).toEqual([]);
  });

  it("marka → podmiot tylko z rejestru usług inwestycyjnych", () => {
    const t212 = BRANDS.find((b) => b.id === "trading212");
    expect(t212).toBeDefined();
    if (!t212) return;
    expect(matchBrandEntity([ENTITY], t212)?.id).toBe(1);
    expect(matchBrandEntity([{ ...ENTITY, investment_register: false }], t212)).toBeNull();
  });

  it("kilka wpisów marki: polski rejestr firm inwestycyjnych przed notyfikacją", () => {
    const xtb = BRANDS.find((b) => b.id === "xtb");
    expect(xtb).toBeDefined();
    if (!xtb) return;
    const ltd = { ...ENTITY, id: 2, name: "XTB Ltd", domains: ["xtb.com"] };
    const sa = {
      ...ENTITY,
      id: 3,
      name: "XTB S.A.",
      register_name: "Firmy inwestycyjne - Domy maklerskie",
    };
    expect(matchBrandEntity([ltd, sa], xtb)?.id).toBe(3);
    expect(matchBrandEntity([ltd], xtb)?.id).toBe(2);
    expect(registerRank("Firmy inwestycyjne - Banki prowadzące działalność maklerską")).toBe(0);
    expect(registerRank("Firmy inwestycyjne - Notyfikacje zagranicznych firm inwestycyjnych")).toBe(
      1,
    );
    expect(registerRank("Agenci firm inwestycyjnych - osoby fizyczne")).toBe(2);
  });

  it("notyfikacja zagranicznej instytucji kredytowej liczy się tylko dla brokera (DEGIRO)", () => {
    const degiro = BRANDS.find((b) => b.id === "degiro");
    const revolut = BRANDS.find((b) => b.id === "revolut");
    expect(degiro && revolut).toBeTruthy();
    if (!degiro || !revolut) return;
    const bank = {
      ...ENTITY,
      investment_register: false,
      register_name: "Notyfikacje zagranicznych instytucji kredytowych na terytorium RP",
    };
    const flatex = { ...bank, id: 4, name: "flatexDEGIRO Bank SE (flatexDEGIRO Bank AG)" };
    expect(matchBrandEntity([flatex], degiro)).toMatchObject({ id: 4, investment_register: true });
    expect(matchBrandEntity([{ ...flatex, deleted: true }], degiro)).toBeNull();
    expect(matchBrandEntity([{ ...bank, id: 5, name: "Revolut Bank UAB" }], revolut)).toBeNull();
  });
});
