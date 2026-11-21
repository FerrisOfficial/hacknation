import { describe, expect, it } from "vitest";
import { contentHash } from "./content-hash";
import { sourceCreateSchema } from "./schemas";
import { detectPlatform, sourceConfig, sourceRow } from "./sources";

describe("sourceConfig", () => {
  it("odczytuje wyszukiwanie YouTube z adresu dla źródeł sprzed kolumny config", () => {
    expect(
      sourceConfig({
        platform: "youtube",
        url: "https://www.youtube.com/results?search_query=XTB+kod&sp=EgOAAgE%3D",
        config: { kind: "web_page" },
      }),
    ).toEqual({ kind: "youtube_search", query: "XTB kod", limit: 10, paidOnly: true });
    expect(
      sourceConfig({
        platform: "youtube",
        url: "https://www.youtube.com/@kanal",
        config: { kind: "web_page" },
      }),
    ).toEqual({ kind: "web_page" });
  });
});

describe("detectPlatform", () => {
  it("rozpoznaje social media po domenie (także subdomeny)", () => {
    expect(detectPlatform("https://www.facebook.com/finfluencer")).toBe("facebook");
    expect(detectPlatform("https://m.facebook.com/x")).toBe("facebook");
    expect(detectPlatform("https://www.tiktok.com/@kanal")).toBe("tiktok");
    expect(detectPlatform("https://twitter.com/kanal")).toBe("x");
    expect(detectPlatform("https://t.me/sygnaly")).toBe("telegram");
    expect(detectPlatform("https://notfacebook.com")).toBe("web");
    expect(detectPlatform("https://broker.example/pl")).toBe("web");
  });
});

describe("sourceRow", () => {
  it("strona WWW: platforma z domeny, adres bez #, nazwa z hosta", () => {
    const input = sourceCreateSchema.parse({
      kind: "web_page",
      url: "https://www.instagram.com/kanal/#posts",
    });
    expect(sourceRow(input)).toMatchObject({
      platform: "instagram",
      url: "https://www.instagram.com/kanal/",
      name: "instagram.com/kanal",
      intervalMinutes: null,
      config: { kind: "web_page" },
    });
  });

  it("wyszukiwanie YouTube: adres wyszukiwarki i konfiguracja kolektora", () => {
    const input = sourceCreateSchema.parse({
      kind: "youtube_search",
      query: "XTB kod",
      intervalMinutes: 60,
    });
    expect(sourceRow(input)).toMatchObject({
      platform: "youtube",
      url: "https://www.youtube.com/results?search_query=XTB+kod&sp=EgOAAgE%3D",
      intervalMinutes: 60,
      config: { kind: "youtube_search", query: "XTB kod", limit: 10, paidOnly: true },
    });
  });

  it("odrzuca adresy inne niż http(s) i za krótki harmonogram", () => {
    expect(
      sourceCreateSchema.safeParse({ kind: "web_page", url: "file:///etc/passwd" }).success,
    ).toBe(false);
    expect(
      sourceCreateSchema.safeParse({ kind: "web_page", url: "https://a.pl", intervalMinutes: 1 })
        .success,
    ).toBe(false);
  });
});

describe("contentHash", () => {
  it("zgodny z content_hash w serwisie ML (services/ml/src/ml/scraper.py)", () => {
    // Wartość z: python -c "from ml.scraper import content_hash; print(content_hash(...))"
    expect(contentHash("  Zarabiaj\n\n 20%  MIESIĘCZNIE z XTB ")).toBe(
      "79380da018d56b52075fc4e051ae7af9b50b91e0a6cea76bbecd7afd526b1cfa",
    );
  });
});
