import { describe, expect, it } from "vitest";
import { highRiskFrom, riskLevel } from "./modules";

describe("riskLevel", () => {
  it("poniżej progu — niski, górna połowa [próg, 1] — wysoki", () => {
    expect(riskLevel(0.49, 0.5)).toBe("low");
    expect(riskLevel(0.5, 0.5)).toBe("medium");
    expect(riskLevel(0.74, 0.5)).toBe("medium");
    expect(riskLevel(0.75, 0.5)).toBe("high");
    expect(riskLevel(1, 0.5)).toBe("high");
  });

  it("granica wysokiego ryzyka idzie za progiem z panelu kalibracji", () => {
    expect(highRiskFrom(0.8)).toBeCloseTo(0.9);
    expect(riskLevel(0.85, 0.8)).toBe("medium");
    expect(riskLevel(0.85, 0.6)).toBe("high");
  });
});
