import type { Flag } from "@/lib/incidents/contract";

// Risk score incydentu: priorytet przeglądu i liczba pokazywana analitykowi.
// Liczony ze score'ów reguł (`flags[].score`, waga × P(naruszenie)) TYLKO tych reguł, które
// przekraczają próg `flag` modułu — niezależnie od etykiety modelu (`result`), bo z tym samym
// score'em porównujemy próg listy. Reguły poniżej progu nie wpływają na wynik.
// Naruszenia od najwyższego: s1 ≥ s2 ≥ …, risk = 1 − (1 − s1)·(1 − s2·½)·(1 − s3·¼)·…
// Najwyższe liczy się w pełni, każde kolejne coraz słabiej: więcej wysokich naruszeń → wyżej,
// a risk nigdy nie spada poniżej najwyższego naruszenia.
// Ten sam wzór w SQL (sortowanie listy): `riskScoreSql` w @/lib/pipeline/thresholds.

export const RISK_DECAY = 0.5;

export function riskScore(
  flags: readonly Pick<Flag, "score">[],
  threshold: number,
  fallback: number,
): number {
  const scores = flags.flatMap((flag) => (flag.score === null ? [] : [flag.score]));
  // M1 i wyniki sprzed score'ów per reguła: bez score'ów reguł zostaje score wyniku.
  if (scores.length === 0) return fallback;
  const above = scores.filter((score) => score >= threshold).sort((a, b) => b - a);
  const remaining = above.reduce((acc, score, rank) => acc * (1 - score * RISK_DECAY ** rank), 1);
  return Math.round((1 - remaining) * 10_000) / 10_000;
}
