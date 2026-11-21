import { describe, expect, it } from "vitest";
import {
  type EntityMaterial,
  extractNip,
  type KnfEntity,
  type KnfWarning,
  materialDomain,
  resolveEntity,
} from "./entity";

const BROKER: KnfEntity = {
  id: 1001,
  name: "Broker Przykładowy S.A.",
  former_names: [],
  deleted: false,
  register_name: "Firmy inwestycyjne - Domy maklerskie",
  register_id: 19,
  investment_register: true,
  attributes: [{ name: "Strona", value: "www.broker.example" }],
  domains: ["broker.example"],
  detail_url: "https://www.knf.gov.pl/podmioty/wyszukiwarka_podmiotow#1001",
};

const ISSUER: KnfEntity = {
  ...BROKER,
  id: 1004,
  name: "Broker Przykładowy SA (emitent)",
  register_name: "Emitenci akcji - rynek regulowany",
  investment_register: false,
};

const WARNING: KnfWarning = {
  category: "art. 178 ustawy o obrocie instrumentami finansowymi",
  number: 7,
  entities: "Szybki Zysk Ltd",
  identifiers: [{ kind: "NIP", value: "5260250274" }],
  prosecutor: null,
  rulings: null,
  notes: null,
  domains: ["szybki-zysk.example"],
};

function material(overrides: Partial<EntityMaterial>): EntityMaterial {
  return {
    url: "https://broker.example",
    platform: "web",
    author: null,
    text: "",
    metadata: {},
    ...overrides,
  };
}

describe("materialDomain", () => {
  it("strona WWW: własna domena bez www", () => {
    expect(materialDomain(material({ url: "https://www.pl.broker.example/oferta" }))).toBe(
      "pl.broker.example",
    );
  });

  it("film: pierwszy link z opisu poza platformami, po przekierowaniach", () => {
    const metadata = {
      links: [
        { domain: "instagram.com", final_domain: null },
        { domain: "bit.ly", final_domain: "broker.example" },
      ],
    };
    expect(materialDomain(material({ url: "https://www.youtube.com/watch?v=x", metadata }))).toBe(
      "broker.example",
    );
    expect(materialDomain(material({ url: "https://www.youtube.com/watch?v=x" }))).toBeNull();
  });
});

describe("extractNip", () => {
  it("NIP z poprawną sumą kontrolną, w różnych zapisach", () => {
    expect(extractNip("Szybki Zysk, NIP: 526-025-02-74")).toBe("5260250274");
    expect(extractNip("nip 5260250275")).toBeNull();
    expect(extractNip("bez numeru")).toBeNull();
  });
});

describe("resolveEntity", () => {
  it("firma z rejestru KNF po domenie — pierwszeństwo ma rejestr usług inwestycyjnych", () => {
    const entity = resolveEntity(material({}), { entities: [ISSUER, BROKER], warnings: [] });
    expect(entity).toEqual({
      firm_name: "Broker Przykładowy S.A.",
      knf_id: 1001,
      in_register: true,
      advertiser: null,
      nip: null,
      domain: "broker.example",
      on_warning_list: false,
    });
  });

  it("podmiot z listy ostrzeżeń, nieznany w rejestrze", () => {
    const entity = resolveEntity(
      material({
        url: "https://www.youtube.com/watch?v=x",
        platform: "youtube",
        author: "Kanał Testowy",
        text: "Szybki Zysk NIP 526-025-02-74",
      }),
      { entities: [], warnings: [WARNING] },
    );
    expect(entity).toMatchObject({
      firm_name: "Szybki Zysk Ltd",
      knf_id: null,
      in_register: false,
      advertiser: "Kanał Testowy",
      nip: "5260250274",
      domain: null,
      on_warning_list: true,
    });
  });

  it("KNF nie odpowiedział albo nie ma czego szukać — null zamiast fałszywego „nie”", () => {
    expect(resolveEntity(material({}), { entities: null, warnings: null })).toMatchObject({
      in_register: null,
      on_warning_list: null,
    });
    const youtube = material({ url: "https://www.youtube.com/watch?v=x", platform: "youtube" });
    expect(resolveEntity(youtube, { entities: [], warnings: [WARNING] })).toMatchObject({
      in_register: null,
      on_warning_list: null,
    });
  });
});
