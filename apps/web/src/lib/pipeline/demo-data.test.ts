import { describe, expect, it } from "vitest";
import { ANALYSIS_MODULES } from "@/lib/analysis/modules";
import { readIncidentDetails } from "@/lib/incidents/contract";
import { demoItems, iveMode } from "./demo-data";

describe("zbiór demo", () => {
  const items = demoItems();

  it("ma co najmniej 10 decyzji analityka na moduł (próg Kalibracji)", () => {
    for (const module of ANALYSIS_MODULES) {
      const labeled = items.filter(
        (i) => i.module === module && (i.status === "confirmed" || i.status === "dismissed"),
      );
      expect(labeled.length, module).toBeGreaterThanOrEqual(10);
    }
  });

  it("ma unikalne URL-e, a cytaty dowodów są w tekście", () => {
    expect(new Set(items.map((i) => i.url)).size).toBe(items.length);
    for (const item of items) {
      for (const flag of item.details.flags) {
        if (flag.evidence) {
          expect(item.text.slice(flag.evidence.start, flag.evidence.end)).toBe(flag.evidence.quote);
        }
      }
    }
  });

  it("details przechodzą przez czytnik bez utraty flag", () => {
    for (const item of items) {
      expect(readIncidentDetails(item.details).flags).toHaveLength(item.details.flags.length);
    }
  });
});

describe("iveMode", () => {
  it("rozpoznaje quick i full, resztę ignoruje", () => {
    expect(iveMode({ IVE_MODE: "quick" })).toBe("quick");
    expect(iveMode({ IVE_MODE: " FULL " })).toBe("full");
    expect(iveMode({ IVE_MODE: "" })).toBeNull();
    expect(iveMode({})).toBeNull();
  });
});
