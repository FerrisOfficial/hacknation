// Co sprawdza reguła i czego dotyczy przepis: podpowiedź w Oknie sprawy. Źródło: zasób UKNF
// dla uczestników „InvestWatch: kryteria oceny informacji o ryzyku” (reguły 1–18). Przepisy
// spoza tabeli (doradztwo) to nasze krótkie omówienia do sprawdzenia z tekstem ustawy.

export const RULE_DESCRIPTION: Record<string, string> = {
  "1": "Czy materiał zawiera oficjalną nazwę firmy inwestycyjnej.",
  "2": "Czy materiał reklamowy jest jednoznacznie oznaczony jako reklama.",
  "3": "Czy twierdzeniom o potencjalnych zyskach bezpośrednio towarzyszy informacja o istotnym ryzyku.",
  "4": "Czy informacja o ryzyku ma czcionkę nie mniejszą niż przeważająca w materiale.",
  "5": "Czy informacja o ryzyku jest czytelna: kontrast, umiejscowienie, brak przesłonięcia.",
  "6": "Czy ryzyko nie jest ukryte w przypisach, sekcji „Legal” lub miejscach o niskiej widoczności.",
  "7": "Czy informacja o ryzyku jest widoczna bez rozwijania, klikania linku czy przechodzenia dalej.",
  "8": "Czy na telefonie, tablecie i komputerze tekst nie jest ucinany ani zmniejszany poniżej czytelności.",
  "9": "Czy ostrzeżenie o ryzyku jest zrozumiałe dla przeciętnego odbiorcy z grupy docelowej.",
  "10": "Czy informacja o ryzyku jest w tym samym języku co główny przekaz.",
  "11": "Przy porównaniu produktów lub usług: czy podano źródło informacji i przyjęte założenia.",
  "12a":
    "Wyniki historyczne: czy obejmują ostatnie 5 lat w pełnych okresach 12-miesięcznych oraz czy wskazano okres referencyjny i źródło.",
  "12b":
    "Wyniki historyczne: czy ostrzeżono o wpływie kursów walut i czy wskazano wpływ prowizji, opłat i obciążeń.",
  "13": "Czy wyniki historyczne nie są najbardziej wyeksponowanym elementem materiału.",
  "14": "Czy jest wyraźne zastrzeżenie, że wyniki historyczne nie są wiarygodnym wskaźnikiem przyszłych.",
  "15": "Przy prognozie: czy jest wyraźne ostrzeżenie, że prognoza nie jest wiarygodnym wskaźnikiem przyszłych wyników.",
  "16": "Przy odwołaniu do podatków: czy zaznaczono, że traktowanie podatkowe zależy od sytuacji klienta i może się zmienić.",
  "17": "Czy odwołanie do KNF lub innego organu nie sugeruje zatwierdzenia albo aprobaty produktu.",
  "18": "Czy odwołanie do nadzoru nie jest używane jako argument, że inwestycja jest bezpieczna.",
};

// Przepisy z tabeli UKNF (art. 44 rozp. del. 2017/565, art. 24 ust. 3 MiFID II) opisane przez
// reguły, które się na nie powołują; doradztwo: nasze omówienie.
const PROVISIONS: { match: RegExp; text: string }[] = [
  { match: /ust\.\s*2\s+lit\.\s*a\b/i, text: "art. 44 ust. 2 lit. a: nazwa firmy inwestycyjnej." },
  {
    match: /ust\.\s*2\s+lit\.\s*b\b/i,
    text: "art. 44 ust. 2 lit. b: korzyści tylko obok rzetelnej i widocznej informacji o ryzyku.",
  },
  {
    match: /ust\.\s*2\s+lit\.\s*c\b/i,
    text: "art. 44 ust. 2 lit. c: informacja o ryzyku co najmniej tak czytelna jak reszta przekazu.",
  },
  {
    match: /ust\.\s*2\s+lit\.\s*d\b/i,
    text: "art. 44 ust. 2 lit. d: zrozumiałość dla przeciętnego odbiorcy z grupy docelowej.",
  },
  {
    match: /ust\.\s*2\s+lit\.\s*e\b/i,
    text: "art. 44 ust. 2 lit. e: istotne informacje i ostrzeżenia nie mogą być ukryte ani pomniejszone.",
  },
  {
    match: /ust\.\s*2\s+lit\.\s*f\b/i,
    text: "art. 44 ust. 2 lit. f: spójny język całego materiału.",
  },
  {
    match: /ust\.\s*2\s+lit\.\s*g\b/i,
    text: "art. 44 ust. 2 lit. g: informacja aktualna i czytelna w każdej formie prezentacji.",
  },
  { match: /ust\.\s*3\b/i, text: "art. 44 ust. 3: porównania z podanym źródłem i założeniami." },
  {
    match: /ust\.\s*4\b/i,
    text: "art. 44 ust. 4: warunki prezentowania wyników historycznych (okres, źródło, waluta, opłaty, zastrzeżenie).",
  },
  { match: /ust\.\s*6\b/i, text: "art. 44 ust. 6: prognozy tylko z wyraźnym ostrzeżeniem." },
  { match: /ust\.\s*7\b/i, text: "art. 44 ust. 7: informacja podatkowa z zastrzeżeniem." },
  { match: /ust\.\s*8\b/i, text: "art. 44 ust. 8: zakaz sugerowania aprobaty organu nadzoru." },
  {
    match: /art\.\s*24\s+ust\.\s*3/i,
    text: "art. 24 ust. 3 MiFID II: komunikat marketingowy musi być wyraźnie rozpoznawalny jako marketing.",
  },
  {
    match: /art\.\s*69\s+ust\.\s*2/i,
    text: "art. 69 ust. 2 ustawy o obrocie: doradztwo inwestycyjne i zarządzanie portfelem wymagają zezwolenia KNF (nasze omówienie).",
  },
  {
    match: /art\.\s*76/i,
    text: "art. 76 ustawy o obrocie: doradztwo to osobista rekomendacja konkretnych instrumentów (nasze omówienie).",
  },
  {
    match: /art\.\s*178/i,
    text: "art. 178 ustawy o obrocie: działalność maklerska bez zezwolenia jest przestępstwem (nasze omówienie).",
  },
];

export function legalSummaries(basis: string | null | undefined, ruleId?: string): string[] {
  const out: string[] = [];
  const rule = ruleId ? RULE_DESCRIPTION[ruleId] : undefined;
  if (rule) out.push(`Sprawdzamy: ${rule}`);
  if (!basis) return out;
  // „art. 44 ust. 2 lit. c i e” → osobno lit. c i lit. e.
  const expanded = basis.replace(/lit\.\s*([a-g])\s+i\s+([a-g])\b/gi, "lit. $1; ust. 2 lit. $2");
  for (const part of expanded.split(/;\s*/)) {
    const hit = PROVISIONS.find((item) => item.match.test(part));
    if (hit && !out.includes(hit.text)) out.push(hit.text);
  }
  return out;
}
