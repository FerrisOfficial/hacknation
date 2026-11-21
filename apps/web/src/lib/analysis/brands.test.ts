import { describe, expect, it } from "vitest";
import {
  BRANDS,
  M1_QUERY_TEMPLATES,
  m1SearchQueries,
  matchBrandEntity,
  mentionedBrands,
} from "./brands";
import type { KnfEntity } from "./entity";

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
  it("frazy: każda marka × każdy szablon, unikalne", () => {
    const queries = m1SearchQueries();
    expect(queries).toHaveLength(BRANDS.length * M1_QUERY_TEMPLATES.length);
    expect(new Set(queries).size).toBe(queries.length);
    expect(queries).toContain("XTB kod");
    expect(queries).toContain("Trading 212 jak założyć konto");
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
});
