import { describe, expect, it } from "vitest";
import { statusAction, systemEvents, withDetection } from "./history";

const thresholds = { flag: 0.55, alert: 0.85 };

describe("systemEvents", () => {
  it("pierwsza analiza ponad progiem: oflagowanie z progiem z chwili zdarzenia", () => {
    expect(systemEvents({ score: 0.84, before: undefined, ...thresholds })).toEqual([
      { kind: "flagged", action: "oflagowano 0,84 przy progu 0,55" },
    ]);
  });

  it("wynik ponad progiem alertu: oflagowanie i alert", () => {
    expect(systemEvents({ score: 0.91, before: 0.4, ...thresholds }).map((e) => e.kind)).toEqual([
      "flagged",
      "alert",
    ]);
  });

  it("ponowna analiza incydentu ze zmianą score'u", () => {
    expect(systemEvents({ score: 0.62, before: 0.84, ...thresholds })).toEqual([
      { kind: "reanalyzed", action: "ponowna analiza: 0,84 → 0,62" },
    ]);
    expect(systemEvents({ score: 0.3, before: 0.84, ...thresholds })).toEqual([
      { kind: "reanalyzed", action: "ponowna analiza: 0,84 → 0,30 (poniżej progu 0,55)" },
    ]);
  });

  it("bez zdarzeń: wynik poniżej progu albo ten sam score po zaokrągleniu", () => {
    expect(systemEvents({ score: 0.2, before: undefined, ...thresholds })).toEqual([]);
    expect(systemEvents({ score: 0.2, before: 0.3, ...thresholds })).toEqual([]);
    expect(systemEvents({ score: 0.8401, before: 0.84, ...thresholds })).toEqual([]);
  });

  it("alert tylko raz: wynik już ponad progiem alertu nie wysyła go ponownie", () => {
    expect(systemEvents({ score: 0.9, before: 0.95, ...thresholds })).toEqual([
      { kind: "reanalyzed", action: "ponowna analiza: 0,95 → 0,90" },
    ]);
  });
});

describe("statusAction", () => {
  it("opisuje decyzję z powodem", () => {
    expect(statusAction("postponed", "dowód niepełny")).toBe("Odłożony: dowód niepełny");
    expect(statusAction("confirmed", null)).toBe("Potwierdzony");
    expect(statusAction("in_review", null)).toBe("otwarto");
    expect(statusAction("new", null)).toBe("przywrócono jako nowy");
  });
});

describe("withDetection", () => {
  const marta = { id: "m", name: "Marta Kowalska", role: "analityczka" };

  it("bez zdarzenia oflagowania dokłada wykrycie z daty incydentu, od najnowszego", () => {
    const history = withDetection(
      [
        {
          kind: "status",
          at: "2026-11-21T21:00:00.000Z",
          actor: marta,
          action: "Potwierdzony",
          status: "confirmed",
        },
      ],
      { at: "2026-11-21T20:00:00.000Z", score: 0.84 },
    );
    expect(history).toEqual([
      {
        at: "2026-11-21T21:00:00.000Z",
        actor: marta,
        action: "Potwierdzony",
        status: "confirmed",
      },
      { at: "2026-11-21T20:00:00.000Z", actor: null, action: "oflagowano 0,84", status: null },
    ]);
  });

  it("z zapisanym oflagowaniem nie dubluje wykrycia", () => {
    const history = withDetection(
      [
        {
          kind: "flagged",
          at: "2026-11-21T20:00:00.000Z",
          actor: null,
          action: "oflagowano 0,84 przy progu 0,55",
          status: null,
        },
      ],
      { at: "2026-11-21T20:00:00.000Z", score: 0.84 },
    );
    expect(history.map((entry) => entry.action)).toEqual(["oflagowano 0,84 przy progu 0,55"]);
  });
});
