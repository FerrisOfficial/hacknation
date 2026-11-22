import type { NewSource } from "@app/db";
import { youtubeSearchSource } from "@/lib/collect/youtube-materials";

// Źródła modułu 3 (czyste mapowanie, bez bazy): frazy, pod którymi oferuje się doradztwo
// inwestycyjne poza firmami inwestycyjnymi — sygnały transakcyjne, grupy VIP, mentoring,
// konsultacje 1:1, wealth management i family office. Wszystkie filmy (nie tylko płatne
// promocje): ofertę zwykle widać w opisie, a kolektor pobiera też strony z linków w opisie.

export const M3_SEARCH_INTERVAL_MINUTES = 12 * 60;
export const M3_SEARCH_LIMIT = 10;

export const M3_SEARCH_QUERIES = [
  "sygnały tradingowe grupa VIP",
  "sygnały forex telegram",
  "sygnały giełdowe abonament",
  "mentoring inwestycyjny",
  "mentoring tradingowy 1 na 1",
  "konsultacje inwestycyjne indywidualne",
  "doradca inwestycyjny konsultacja",
  "zarządzanie majątkiem klienta",
  "wealth management Polska",
  "family office Polska",
  "portfel inwestycyjny dla klienta",
  "pomogę Ci zainwestować oszczędności",
] as const;

export function m3SearchSourceRows(): NewSource[] {
  return M3_SEARCH_QUERIES.map((query) => ({
    ...youtubeSearchSource(query, false),
    name: `M3: „${query}”`,
    active: true,
    intervalMinutes: M3_SEARCH_INTERVAL_MINUTES,
    config: { kind: "youtube_search", query, limit: M3_SEARCH_LIMIT, paidOnly: false },
  }));
}
