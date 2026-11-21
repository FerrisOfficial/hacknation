import { describe, expect, it } from "vitest";
import {
  calibrationCurve,
  metricsAt,
  recommendedThreshold,
  type ScoreBucket,
  scoreBucket,
} from "./calibration";

// 4 potwierdzone naruszenia (score 0.9, 0.8, 0.6, 0.3), 3 fałszywe alarmy (0.7, 0.4, 0.2),
// 2 bez decyzji (0.95, 0.1).
const HISTOGRAM: ScoreBucket[] = [
  { bucket: 90, positive: 1, negative: 0, unlabeled: 0 },
  { bucket: 80, positive: 1, negative: 0, unlabeled: 0 },
  { bucket: 60, positive: 1, negative: 0, unlabeled: 0 },
  { bucket: 30, positive: 1, negative: 0, unlabeled: 0 },
  { bucket: 70, positive: 0, negative: 1, unlabeled: 0 },
  { bucket: 40, positive: 0, negative: 1, unlabeled: 0 },
  { bucket: 20, positive: 0, negative: 1, unlabeled: 0 },
  { bucket: 95, positive: 0, negative: 0, unlabeled: 1 },
  { bucket: 10, positive: 0, negative: 0, unlabeled: 1 },
];

describe("scoreBucket", () => {
  it("liczy koszyk w dół, z odpornością na błąd float", () => {
    expect(scoreBucket(0.5)).toBe(50);
    expect(scoreBucket(0.499)).toBe(49);
    expect(scoreBucket(0.29)).toBe(29);
    expect(scoreBucket(1)).toBe(100);
    expect(scoreBucket(0)).toBe(0);
  });
});

describe("metricsAt", () => {
  it("liczy macierz pomyłek dla progu", () => {
    const m = metricsAt(HISTOGRAM, 0.5);
    expect(m).toMatchObject({
      truePositive: 3,
      falsePositive: 1,
      falseNegative: 1,
      trueNegative: 2,
      precision: 0.75,
      recall: 0.75,
      f1: 0.75,
      flagged: 5,
      flaggedUnlabeled: 1,
    });
  });

  it("wyższy próg: mniej FP, więcej FN", () => {
    const low = metricsAt(HISTOGRAM, 0.25);
    const high = metricsAt(HISTOGRAM, 0.75);
    expect(high.falsePositive).toBeLessThan(low.falsePositive);
    expect(high.falseNegative).toBeGreaterThan(low.falseNegative);
  });

  it("wynik równy progowi jest flagowany", () => {
    expect(metricsAt(HISTOGRAM, 0.6).truePositive).toBe(3);
    expect(metricsAt(HISTOGRAM, 0.61).truePositive).toBe(2);
  });

  it("bez oznaczonych danych zwraca null zamiast dzielenia przez zero", () => {
    const m = metricsAt([{ bucket: 50, positive: 0, negative: 0, unlabeled: 3 }], 0.5);
    expect(m.precision).toBeNull();
    expect(m.recall).toBeNull();
    expect(m.f1).toBeNull();
    expect(m.flagged).toBe(3);
  });
});

describe("calibrationCurve / recommendedThreshold", () => {
  it("krzywa ma progi 0–1 co 0.05", () => {
    const curve = calibrationCurve(HISTOGRAM);
    expect(curve).toHaveLength(21);
    expect(curve[0]?.threshold).toBe(0);
    expect(curve[20]?.threshold).toBe(1);
  });

  it("rekomenduje próg z najlepszym F1 (przy remisie wyższy)", () => {
    const threshold = recommendedThreshold(calibrationCurve(HISTOGRAM));
    const best = metricsAt(HISTOGRAM, threshold ?? 0);
    for (const point of calibrationCurve(HISTOGRAM)) {
      expect(point.f1 ?? 0).toBeLessThanOrEqual(best.f1 ?? 0);
    }
  });

  it("bez etykiet nie rekomenduje", () => {
    expect(recommendedThreshold(calibrationCurve([]))).toBeNull();
  });
});
