import type { AnalysisModule, Platform, ReviewStatus } from "@app/db";
import { ADVISORY_ALLOWED, ADVISORY_POSITIVE } from "@/lib/analysis/advisory";
import { evidenceLink } from "@/lib/analysis/evidence";
import { FINFLUENCER_MODEL } from "@/lib/analysis/finfluencer";
import { findRule } from "@/lib/analysis/rules";
import type { Flag, IncidentDetails } from "@/lib/incidents/contract";

// Zbiór demo (IVE_MODE, @/lib/pipeline/bootstrap): fikcyjne materiały z wynikami modułów i
// decyzjami analityka, żeby dashboard, trend i Kalibracja działały od pierwszego uruchomienia.
// Firmy, autorzy i domeny są wymyślone (TLD `.example`, RFC 2606) — to nie są prawdziwe podmioty.

export type IveMode = "quick" | "full";

export function iveMode(env: Record<string, string | undefined> = process.env): IveMode | null {
  const mode = env.IVE_MODE?.trim().toLowerCase();
  return mode === "quick" || mode === "full" ? mode : null;
}

export type DemoItem = {
  module: AnalysisModule;
  platform: Platform;
  url: string;
  title: string;
  author: string;
  text: string;
  score: number;
  label: string;
  model: string;
  details: IncidentDetails;
  status: ReviewStatus;
  // Ile godzin temu wykryto (trend incydentów z kilku dni).
  hoursAgo: number;
};

const FIRMS = [
  { name: "Alfa Dom Maklerski S.A.", domain: "alfa-dm.example", knfId: 9001, code: "ALFA50" },
  { name: "Wisła Inwestycje TFI S.A.", domain: "wisla-tfi.example", knfId: 9002, code: "WISLA" },
  { name: "Bałtyk Brokers S.A.", domain: "baltyk-brokers.example", knfId: 9003, code: "BB100" },
  { name: "Tatra Capital Markets Ltd", domain: "tatra-cm.example", knfId: 9004, code: "TATRA" },
] as const;

const AUTHORS = [
  "Inwestuj z Kubą",
  "Finanse Bez Ściemy",
  "Krypto Ania",
  "Giełdowy Tata",
  "Pasywny Dochód PL",
  "Młody Inwestor",
] as const;

const ADVISORS = [
  { name: "Prestige Wealth Partners", domain: "prestige-wealth.example" },
  { name: "Złoty Portfel Consulting", domain: "zloty-portfel.example" },
  { name: "Family Office Nova", domain: "fo-nova.example" },
  { name: "Sygnały VIP Trading Club", domain: "vip-signals.example" },
] as const;

// Rozkład wyników i decyzji: większość wysokich to trafienia, kilka wysokich to fałszywe alarmy
// (FP), kilka niskich to pominięcia (FN) — przesunięcie progu w Kalibracji widocznie zmienia bilans.
const PLAN: readonly { score: number; status: ReviewStatus }[] = [
  { score: 0.97, status: "confirmed" },
  { score: 0.93, status: "confirmed" },
  { score: 0.9, status: "new" },
  { score: 0.88, status: "confirmed" },
  { score: 0.84, status: "dismissed" },
  { score: 0.81, status: "confirmed" },
  { score: 0.76, status: "new" },
  { score: 0.72, status: "confirmed" },
  { score: 0.68, status: "dismissed" },
  { score: 0.63, status: "confirmed" },
  { score: 0.58, status: "dismissed" },
  { score: 0.54, status: "in_review" },
  { score: 0.47, status: "confirmed" },
  { score: 0.42, status: "dismissed" },
  { score: 0.36, status: "confirmed" },
  { score: 0.31, status: "dismissed" },
  { score: 0.24, status: "dismissed" },
  { score: 0.15, status: "dismissed" },
];

function flag(
  module: AnalysisModule,
  ruleId: string,
  item: { url: string; platform: Platform; text: string },
  result: Flag["result"],
  score: number,
  reason: string,
  quote: string | null,
): Flag {
  const rule = findRule(module, ruleId);
  const start = quote ? item.text.indexOf(quote) : -1;
  return {
    rule_id: ruleId,
    rule_name: rule?.name ?? ruleId,
    legal_basis: rule?.legalBasis ?? "",
    kind: rule?.kind ?? "hard",
    result,
    confidence: result === "n/a" ? 0 : Math.max(score, 1 - score),
    score: result === "n/a" ? null : score,
    reason,
    evidence:
      quote && start >= 0
        ? {
            quote,
            start,
            end: start + quote.length,
            timestamp_s: item.platform === "youtube" ? 30 + Math.round(score * 200) : null,
            link: evidenceLink(item.url, item.platform, quote, null),
          }
        : null,
  };
}

function hoursAgo(i: number, module: number): number {
  return 3 + ((i * 9 + module * 5) % 160);
}

function finfluencerItems(): DemoItem[] {
  return PLAN.map(({ score, status }, i) => {
    const firm = FIRMS[i % FIRMS.length] ?? FIRMS[0];
    const author = AUTHORS[i % AUTHORS.length] ?? AUTHORS[0];
    const strong = score >= 0.5;
    const quote = strong
      ? `z moim kodem ${firm.code} dostajesz bonus na start w ${firm.name}`
      : `korzystam z platformy ${firm.name}`;
    const text = strong
      ? `Dzisiaj pokazuję, jak założyć konto i kupić pierwsze ETF-y. Link w opisie — ${quote}. To najlepszy broker, sam z niego korzystam od lat i polecam każdemu, kto chce zacząć inwestować.`
      : `Podsumowanie miesiąca na moim portfelu. Od dwóch lat ${quote}, ale to nie jest współpraca ani reklama. Opowiadam o swoich błędach i o tym, czego się nauczyłem.`;
    const url = `https://www.youtube.com/watch?v=demoM1${String(i).padStart(4, "0")}`;
    const item = { url, platform: "youtube" as const, text };
    return {
      module: "finfluencer",
      platform: "youtube",
      url,
      title: strong
        ? `Jak zacząć inwestować? ${firm.name} krok po kroku`
        : "Mój portfel — podsumowanie",
      author,
      text,
      score,
      label: strong ? "reklama_podmiotu_trzeciego" : "brak_reklamy",
      model: FINFLUENCER_MODEL,
      details: {
        summary: strong
          ? `${author} reklamuje ${firm.name} z kodem polecającym ${firm.code}.`
          : `${author} wspomina ${firm.name} bez cech reklamy.`,
        entity: {
          firm_name: firm.name,
          knf_id: firm.knfId,
          in_register: true,
          advertiser: author,
          nip: null,
          domain: firm.domain,
          on_warning_list: false,
        },
        flags: [
          flag(
            "finfluencer",
            "M1.ad",
            item,
            strong ? "violation" : "ok",
            score,
            strong ? "Kod polecający i zachęta do otwarcia konta." : "Wzmianka bez zachęty.",
            quote,
          ),
        ],
        error: null,
      },
      status,
      hoursAgo: hoursAgo(i, 1),
    };
  });
}

function riskItems(): DemoItem[] {
  return PLAN.map(({ score, status }, i) => {
    const firm = FIRMS[i % FIRMS.length] ?? FIRMS[0];
    const strong = score >= 0.5;
    const gain = "Nawet 40% zysku rocznie — dołącz do tysięcy zadowolonych klientów";
    const promise = "gwarantujemy stabilny wzrost Twojego kapitału";
    const warning =
      "CFD są złożonymi instrumentami i wiążą się z dużym ryzykiem szybkiej utraty środków.";
    const text = strong
      ? `${firm.name}. ${gain}! Z nami ${promise}. Otwórz rachunek w 5 minut na ${firm.domain}.`
      : `${firm.name} — rachunek maklerski. ${warning} 74% rachunków inwestorów detalicznych traci pieniądze. Wyniki historyczne nie gwarantują przyszłych zysków.`;
    const platform: Platform = i % 3 === 0 ? "web" : "youtube";
    const url =
      platform === "web"
        ? `https://${firm.domain}/promocja-${i}`
        : `https://www.youtube.com/watch?v=demoM2${String(i).padStart(4, "0")}`;
    const item = { url, platform, text };
    const flags: Flag[] = strong
      ? [
          flag("risk_disclosure", "1", item, "ok", 0.1, "Nazwa firmy podana.", firm.name),
          flag(
            "risk_disclosure",
            "3",
            item,
            "violation",
            score,
            "Brak informacji o ryzyku przy obietnicy zysku.",
            gain,
          ),
          flag(
            "risk_disclosure",
            "15",
            item,
            score > 0.7 ? "violation" : "ok",
            score > 0.7 ? score - 0.05 : 0.3,
            "Obietnica przyszłych wyników bez zastrzeżeń.",
            promise,
          ),
          flag("risk_disclosure", "16", item, "n/a", 0, "Brak treści podatkowych.", null),
        ]
      : [
          flag("risk_disclosure", "1", item, "ok", 0.05, "Nazwa firmy podana.", firm.name),
          flag("risk_disclosure", "3", item, "ok", score, "Ostrzeżenie o ryzyku obecne.", warning),
          flag("risk_disclosure", "15", item, "ok", 0.1, "Brak prognoz.", null),
        ];
    return {
      module: "risk_disclosure",
      platform,
      url,
      title: strong ? `${firm.name}: ${gain}` : `${firm.name} — otwórz rachunek`,
      author: firm.name,
      text,
      score,
      label: strong ? "naruszenie" : "brak_naruszenia",
      model: "services/ml risk (rules)",
      details: {
        summary: strong
          ? "Obietnica zysku bez wyważonej informacji o ryzyku (reguły 3 i 15)."
          : "Informacja o ryzyku obecna i proporcjonalna.",
        entity: {
          firm_name: firm.name,
          knf_id: firm.knfId,
          in_register: true,
          advertiser: null,
          nip: null,
          domain: firm.domain,
          on_warning_list: false,
        },
        flags,
        error: null,
      },
      status,
      hoursAgo: hoursAgo(i, 2),
    };
  });
}

function advisoryItems(): DemoItem[] {
  return PLAN.map(({ score, status }, i) => {
    const firm = ADVISORS[i % ADVISORS.length] ?? ADVISORS[0];
    const strong = score >= 0.5;
    const offer = "indywidualny plan inwestycyjny dopasowany do Twojej sytuacji";
    const pick = "kupuj teraz akcje z naszej listy, zanim wzrosną";
    const paid = "konsultacja 1:1 za 990 zł";
    const text = strong
      ? `${firm.name}: przygotujemy ${offer}. W pakiecie premium ${pick}. Zarezerwuj ${paid}. Kontakt: biuro@${firm.domain}, tel. 500 100 ${String(100 + i)}.`
      : `${firm.name} — blog o finansach osobistych. Piszemy o budżecie domowym, oszczędzaniu i podstawach rynku. Nie świadczymy doradztwa inwestycyjnego. Kontakt: biuro@${firm.domain}.`;
    const url = `https://${firm.domain}/oferta-${i}`;
    const item = { url, platform: "web" as const, text };
    const flags: Flag[] = strong
      ? [
          flag(
            "unauthorized_advisory",
            "M3.offer",
            item,
            "violation",
            score,
            "Oferta usługi.",
            offer,
          ),
          flag(
            "unauthorized_advisory",
            "M3.recommendation",
            item,
            "violation",
            score - 0.03,
            "Rekomendacja konkretnych instrumentów.",
            pick,
          ),
          flag(
            "unauthorized_advisory",
            "M3.paid",
            item,
            "violation",
            0.8,
            "Usługa odpłatna.",
            paid,
          ),
        ]
      : [
          flag(
            "unauthorized_advisory",
            "M3.disclaimer",
            item,
            "ok",
            score,
            "Zastrzeżenie bez oferty indywidualnej.",
            "Nie świadczymy doradztwa inwestycyjnego.",
          ),
        ];
    return {
      module: "unauthorized_advisory",
      platform: "web",
      url,
      title: strong ? `${firm.name} — doradztwo premium` : `${firm.name} — blog`,
      author: firm.name,
      text,
      score,
      label: strong ? ADVISORY_POSITIVE : ADVISORY_ALLOWED,
      model: "services/ml advisory (rules)",
      details: {
        summary: strong
          ? "Oferta doradztwa dopasowanego do klienta z rekomendacjami, podmiot bez zezwolenia KNF."
          : "Treści edukacyjne bez oferty doradztwa.",
        entity: {
          firm_name: firm.name,
          knf_id: null,
          in_register: false,
          advertiser: null,
          nip: null,
          domain: firm.domain,
          on_warning_list: i % 4 === 3,
        },
        flags,
        error: null,
        contact: { emails: [`biuro@${firm.domain}`], phones: strong ? [`500 100 ${100 + i}`] : [] },
        signals: { offer: strong ? score : 0.1, personal: strong ? score : 0.05 },
      },
      status,
      hoursAgo: hoursAgo(i, 3),
    };
  });
}

export function demoItems(): DemoItem[] {
  return [...finfluencerItems(), ...riskItems(), ...advisoryItems()];
}
