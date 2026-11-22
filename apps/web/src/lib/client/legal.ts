// Krótkie omówienia przepisów do podpowiedzi w Oknie sprawy. To streszczenia własnymi słowami,
// nie cytaty; do decyzji analityk sięga do pełnego tekstu przepisu.
const SUMMARIES: { match: RegExp; text: string }[] = [
  {
    match: /art\.\s*44\s+ust\.\s*4/i,
    text: "Wyniki historyczne: trzeba podać okres co najmniej 5 lat w pełnych 12-miesięcznych odcinkach, wskazać źródło i wyraźnie zaznaczyć, że przeszłe wyniki nie gwarantują przyszłych.",
  },
  {
    match: /art\.\s*44\s+ust\.\s*2\s+lit\.\s*b/i,
    text: "Informacja nie może eksponować korzyści bez rzetelnego i równie widocznego wskazania ryzyka.",
  },
  {
    match: /art\.\s*44\s+ust\.\s*2/i,
    text: "Informacja dla klienta ma być rzetelna, jasna i niewprowadzająca w błąd: korzyści tylko obok uczciwie i widocznie podanego ryzyka, zrozumiała dla odbiorcy, bez ukrywania ważnych zastrzeżeń.",
  },
  {
    match: /art\.\s*44/i,
    text: "Rozporządzenie del. 2017/565, art. 44: warunki rzetelnej, jasnej i niewprowadzającej w błąd informacji dla klientów, w tym prezentacji ryzyka i wyników.",
  },
  {
    match: /art\.\s*24\s+ust\.\s*3/i,
    text: "MiFID II, art. 24 ust. 3: komunikaty marketingowe firmy inwestycyjnej muszą być rzetelne, jasne, niewprowadzające w błąd i wyraźnie rozpoznawalne jako marketing.",
  },
  {
    match: /art\.\s*69\s+ust\.\s*2/i,
    text: "Ustawa o obrocie instrumentami finansowymi, art. 69 ust. 2: doradztwo inwestycyjne (pkt 5) i zarządzanie portfelem (pkt 4) wymagają zezwolenia KNF.",
  },
  {
    match: /art\.\s*76/i,
    text: "Ustawa o obrocie, art. 76: doradztwo inwestycyjne to osobista rekomendacja dotycząca konkretnych instrumentów, dopasowana do sytuacji odbiorcy.",
  },
  {
    match: /art\.\s*178/i,
    text: "Ustawa o obrocie, art. 178: prowadzenie działalności maklerskiej, w tym doradztwa, bez zezwolenia jest przestępstwem.",
  },
];

export function legalSummaries(basis: string | null | undefined): string[] {
  if (!basis) return [];
  const parts = basis.split(/;\s*/);
  const out: string[] = [];
  for (const part of parts) {
    const hit = SUMMARIES.find((item) => item.match.test(part));
    if (hit && !out.includes(hit.text)) out.push(hit.text);
  }
  return out;
}
