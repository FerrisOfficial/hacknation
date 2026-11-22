// Panel kalibracji: jak próg zmienia liczbę False Positive / False Negative.
// Prawdę bazową dają decyzje analityków: `confirmed` = naruszenie, `dismissed` = fałszywy alarm.
// Wyniki bez decyzji (`new`, `in_review`, `postponed`) liczymy osobno — pokazują, ile alertów wygeneruje próg.
//
// Wejście to histogram: liczba wyników w koszyku score (setne części) per rodzaj etykiety. Dzięki
// temu baza zwraca najwyżej 101 × 3 wierszy niezależnie od liczby materiałów.

export const SCORE_BUCKETS = 100;

export type ScoreBucket = {
  // Score zaokrąglony w dół do setnych, jako liczba całkowita 0–100.
  bucket: number;
  positive: number;
  negative: number;
  unlabeled: number;
};

export type ThresholdMetrics = {
  threshold: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  // null, gdy mianownik jest zerem (np. brak oznaczonych wyników).
  precision: number | null;
  recall: number | null;
  f1: number | null;
  // Ile wyników (także nieoznaczonych) przekroczyłoby próg — tyle alertów zobaczy analityk.
  flagged: number;
  flaggedUnlabeled: number;
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10_000) / 10_000;
}

// Koszyk 0–100 dla score 0–1. Granica progu: wynik jest flagowany, gdy score >= próg, więc
// koszyk liczymy w dół (score 0.499 → 49, próg 0.5 → od koszyka 50).
export function scoreBucket(score: number): number {
  return Math.min(SCORE_BUCKETS, Math.max(0, Math.floor(score * SCORE_BUCKETS + 1e-9)));
}

export function metricsAt(histogram: readonly ScoreBucket[], threshold: number): ThresholdMetrics {
  const from = scoreBucket(threshold);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let flaggedUnlabeled = 0;
  for (const row of histogram) {
    if (row.bucket >= from) {
      tp += row.positive;
      fp += row.negative;
      flaggedUnlabeled += row.unlabeled;
    } else {
      fn += row.positive;
      tn += row.negative;
    }
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  return {
    threshold,
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    trueNegative: tn,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    flagged: tp + fp + flaggedUnlabeled,
    flaggedUnlabeled,
  };
}

// Krzywa precision/recall dla progów co `step` (domyślnie 0.05) — do wykresu w panelu.
export function calibrationCurve(
  histogram: readonly ScoreBucket[],
  step = 0.05,
): ThresholdMetrics[] {
  const steps = Math.round(1 / step);
  return Array.from({ length: steps + 1 }, (_, i) =>
    metricsAt(histogram, Math.round(i * step * 100) / 100),
  );
}

// Próg z najlepszym F1 (przy remisie — wyższy, czyli mniej alertów). null bez oznaczonych danych.
export function recommendedThreshold(curve: readonly ThresholdMetrics[]): number | null {
  let best: ThresholdMetrics | null = null;
  for (const point of curve) {
    if (point.f1 === null) continue;
    if (best === null || best.f1 === null || point.f1 >= best.f1) best = point;
  }
  return best?.threshold ?? null;
}
