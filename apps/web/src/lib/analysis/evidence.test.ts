import { describe, expect, it } from "vitest";
import { buildEvidence, evidenceLink, findQuote, transcriptTimestamp } from "./evidence";

const TEXT =
  "Zarabiaj nawet 20% rocznie!\n\nInwestycja jest w pełni bezpieczna – nadzoruje nas KNF.";

describe("findQuote", () => {
  it("dosłowny cytat", () => {
    const span = findQuote(TEXT, "nawet 20% rocznie");
    expect(span).not.toBeNull();
    expect(TEXT.slice(span?.start, span?.end)).toBe("nawet 20% rocznie");
  });

  it("ignoruje wielkość liter, białe znaki, cudzysłowy, myślniki i wielokropek", () => {
    const span = findQuote(TEXT, "„rocznie!  inwestycja jest w pełni BEZPIECZNA - nadzoruje…”");
    expect(TEXT.slice(span?.start, span?.end)).toBe(
      "rocznie!\n\nInwestycja jest w pełni bezpieczna – nadzoruje",
    );
  });

  it("null dla parafrazy i pustego cytatu", () => {
    expect(findQuote(TEXT, "zysk 20% gwarantowany")).toBeNull();
    expect(findQuote(TEXT, "  ")).toBeNull();
  });
});

describe("transcriptTimestamp", () => {
  const metadata = {
    kind: "youtube_video",
    transcript: {
      segments: [
        { start: 0.5, text: "Cześć, dzisiaj o inwestowaniu." },
        { start: 12.8, text: "Z moim kodem dostaniesz" },
        { start: 15.2, text: "darmowe akcje w XTB." },
      ],
    },
  };

  it("sekunda segmentu, w którym zaczyna się cytat (także przez granicę segmentów)", () => {
    expect(transcriptTimestamp(metadata, "kodem dostaniesz darmowe akcje")).toBe(12);
    expect(transcriptTimestamp(metadata, "darmowe akcje")).toBe(15);
  });

  it("null bez napisów albo gdy cytatu nie ma w napisach", () => {
    expect(transcriptTimestamp({}, "darmowe akcje")).toBeNull();
    expect(transcriptTimestamp(metadata, "tytuł filmu")).toBeNull();
  });
});

describe("evidenceLink", () => {
  it("WWW: Text Fragment z zakodowanymi myślnikami", () => {
    expect(evidenceLink("https://broker.example/oferta", "web", "zysk - 20%", null)).toBe(
      "https://broker.example/oferta#:~:text=zysk%20%2D%2020%25",
    );
  });

  it("WWW z istniejącym #: dyrektywa po fragmencie", () => {
    expect(evidenceLink("https://broker.example/#oferta", "web", "zysk", null)).toBe(
      "https://broker.example/#oferta:~:text=zysk",
    );
  });

  it("YouTube: &t=…s, bez sekundy goły URL", () => {
    const url = "https://www.youtube.com/watch?v=AAAAAAAAAA1";
    expect(evidenceLink(url, "youtube", "cokolwiek", 12)).toBe(`${url}&t=12s`);
    expect(evidenceLink(url, "youtube", "cokolwiek", null)).toBe(url);
  });
});

describe("buildEvidence", () => {
  it("cytat z tekstu materiału, pozycje i link", () => {
    const evidence = buildEvidence(
      { url: "https://broker.example", platform: "web", text: TEXT, metadata: {} },
      "NAWET 20% rocznie",
    );
    expect(evidence).toEqual({
      quote: "nawet 20% rocznie",
      start: 9,
      end: 26,
      timestamp_s: null,
      link: "https://broker.example#:~:text=nawet%2020%25%20rocznie",
    });
  });

  it("null, gdy cytatu nie ma w tekście albo model go nie podał", () => {
    const material = {
      url: "https://b.example",
      platform: "web" as const,
      text: TEXT,
      metadata: {},
    };
    expect(buildEvidence(material, "czego tu nie ma")).toBeNull();
    expect(buildEvidence(material, null)).toBeNull();
  });
});
