import type { AnalysisModule } from "@app/db";
import type { RuleKind } from "@/lib/incidents/contract";

// Katalog reguł (docs/KONTRAKT.md §1, §3): `rule_id` → nazwa, podstawa prawna, `kind`.
// `kind` pochodzi stąd, nie od modelu. `hard`: naruszenie wprost sprawdzalne w tekście,
// `suggestion`: wskazówka do ręcznej weryfikacji (reguły wizualne i ocenne).
// M2: kryteria UKNF z docs/materialy-uknf/kryteria-informacji-o-ryzyku.md.

export type Rule = {
  id: string;
  module: AnalysisModule;
  name: string;
  legalBasis: string;
  kind: RuleKind;
  // Czy model ocenia regułę z samego tekstu (`rules` w wejściu modelu, §1). Reguły wizualne
  // (czcionka, kontrast, responsywność) wymagają zrzutu strony, więc na razie ich nie wysyłamy.
  textual: boolean;
};

const DEL_2017_565 = "rozporządzenia del. 2017/565";

const RISK_DISCLOSURE_RULES: Rule[] = [
  rule("1", "Identyfikacja firmy", `art. 44 ust. 2 lit. a ${DEL_2017_565}`, "hard", true),
  rule("2", "Oznaczenie reklamy", "art. 24 ust. 3 MiFID II", "hard", true),
  rule("3", "Informacja o ryzyku", `art. 44 ust. 2 lit. b ${DEL_2017_565}`, "hard", true),
  rule("4", "Rozmiar czcionki ryzyka", `art. 44 ust. 2 lit. c ${DEL_2017_565}`, "suggestion"),
  rule(
    "5",
    "Ekspozycja i kontrast ryzyka",
    `art. 44 ust. 2 lit. c i e ${DEL_2017_565}`,
    "suggestion",
  ),
  rule("6", "Zakrywanie / ukrywanie ryzyka", `art. 44 ust. 2 lit. e ${DEL_2017_565}`, "suggestion"),
  rule(
    "7",
    "Dostępność za 1 kliknięciem",
    `art. 44 ust. 2 lit. b i e ${DEL_2017_565}`,
    "suggestion",
  ),
  rule(
    "8",
    "Responsywność (różne urządzenia)",
    `art. 44 ust. 2 lit. g ${DEL_2017_565}`,
    "suggestion",
  ),
  rule(
    "9",
    "Zrozumiałość dla grupy docelowej",
    `art. 44 ust. 2 lit. d ${DEL_2017_565}`,
    "suggestion",
    true,
  ),
  rule("10", "Spójność językowa", `art. 44 ust. 2 lit. f ${DEL_2017_565}`, "hard", true),
  rule("11", "Porównania produktów / usług", `art. 44 ust. 3 ${DEL_2017_565}`, "suggestion", true),
  rule(
    "12a",
    "Wyniki historyczne — okres i zakres",
    `art. 44 ust. 4 ${DEL_2017_565}`,
    "hard",
    true,
  ),
  rule(
    "12b",
    "Wyniki historyczne — warunki i waluta",
    `art. 44 ust. 4 ${DEL_2017_565}`,
    "hard",
    true,
  ),
  rule(
    "13",
    "Dominacja wyników historycznych",
    `art. 44 ust. 4 lit. a ${DEL_2017_565}`,
    "suggestion",
  ),
  rule(
    "14",
    "Ostrzeżenie przy wynikach historycznych",
    `art. 44 ust. 4 lit. d ${DEL_2017_565}`,
    "hard",
    true,
  ),
  rule("15", "Prognozy przyszłych wyników", `art. 44 ust. 6 ${DEL_2017_565}`, "hard", true),
  rule("16", "Informacja podatkowa", `art. 44 ust. 7 ${DEL_2017_565}`, "hard", true),
  rule(
    "17",
    "Zakaz sugerowania aprobaty organu nadzoru",
    `art. 44 ust. 8 ${DEL_2017_565}`,
    "hard",
    true,
  ),
  rule("18", "Nadzór jako argument bezpieczeństwa", `art. 44 ust. 8 ${DEL_2017_565}`, "hard", true),
].map((r) => ({ ...r, module: "risk_disclosure" as const }));

export const RULES: readonly Rule[] = [
  // M1 nie idzie do modelu — flagę wystawia `@/lib/analysis/finfluencer` z sygnałów reklamy.
  {
    id: "M1.ad",
    module: "finfluencer",
    name: "Reklama firmy inwestycyjnej przez podmiot trzeci",
    legalBasis: `art. 24 ust. 3 MiFID II; art. 44 ${DEL_2017_565}`,
    kind: "hard",
    textual: true,
  },
  ...RISK_DISCLOSURE_RULES,
  {
    id: "M3.advisory",
    module: "unauthorized_advisory",
    name: "Doradztwo inwestycyjne bez zezwolenia KNF",
    legalBasis: "art. 69 ust. 2 pkt 5 i art. 76 ustawy o obrocie instrumentami finansowymi",
    kind: "hard",
    textual: true,
  },
];

function rule(
  id: string,
  name: string,
  legalBasis: string,
  kind: RuleKind,
  textual = false,
): Omit<Rule, "module"> {
  return { id, name, legalBasis, kind, textual };
}

export function moduleRules(module: AnalysisModule): Rule[] {
  return RULES.filter((r) => r.module === module);
}

// `rules` w wejściu modelu (§1): reguły modułu, które da się ocenić z tekstu.
export function requestedRuleIds(module: AnalysisModule): string[] {
  return moduleRules(module)
    .filter((r) => r.textual)
    .map((r) => r.id);
}

export function findRule(module: AnalysisModule, ruleId: string): Rule | undefined {
  return RULES.find((r) => r.module === module && r.id === ruleId);
}
