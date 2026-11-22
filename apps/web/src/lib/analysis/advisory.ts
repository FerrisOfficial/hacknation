import type { Flag, IncidentEntity } from "@/lib/incidents/contract";
import type { AnalysisSubject } from "./contract";
import { findRule } from "./rules";

// Moduł 3: model ocenia z treści, czy ktoś oferuje doradztwo inwestycyjne (P z `probability`),
// a backend rozstrzyga z rejestru KNF, czy ma do tego zezwolenie. Czyste funkcje.
//
// - podmiot z aktualnym wpisem w rejestrze usług inwestycyjnych → doradztwo jest dozwolone:
//   score × REGISTERED_FACTOR, etykieta `usluga_dozwolona`,
// - podmiot na liście ostrzeżeń publicznych KNF → score podbity (1 − (1 − P) × WARNING_FACTOR),
// - spoza rejestru albo nieznany → score = P.

export const ADVISORY_POSITIVE = "potencjalne_doradztwo";
export const ADVISORY_ALLOWED = "usluga_dozwolona";
export const ADVISORY_NONE = "brak_przeslanek";

const REGISTERED_FACTOR = 0.2;
const WARNING_FACTOR = 0.4;
// Od tego P przesłanki doradztwa są na tyle silne, że brak zezwolenia pokazujemy jako naruszenie.
const LICENSE_RELEVANT = 0.3;

// Dane podmiotu z treści (nazwa, NIP) uzupełniają `entity`, gdy rejestr KNF go nie zna.
export function advisoryEntity(
  entity: IncidentEntity,
  subject: AnalysisSubject | null,
): IncidentEntity {
  if (!subject) return entity;
  const nip = subject.identifiers.find((i) => i.kind === "NIP")?.value ?? null;
  return {
    ...entity,
    firm_name: entity.firm_name ?? subject.name,
    nip: entity.nip ?? nip,
  };
}

function licenseFlag(entity: IncidentEntity, p: number): Flag | null {
  const rule = findRule("unauthorized_advisory", "M3.license");
  if (!rule) return null;
  const base = {
    rule_id: rule.id,
    rule_name: rule.name,
    legal_basis: rule.legalBasis,
    kind: rule.kind,
    score: null,
    evidence: null,
  };
  const who = entity.firm_name ?? entity.domain ?? "podmiot";
  if (entity.on_warning_list) {
    return {
      ...base,
      result: "violation",
      confidence: 0.95,
      reason: `${who} jest na liście ostrzeżeń publicznych KNF (działalność bez zezwolenia).`,
    };
  }
  if (entity.in_register) {
    return {
      ...base,
      result: "ok",
      confidence: 0.95,
      reason: `${who} ma aktualny wpis w rejestrze usług inwestycyjnych KNF — może świadczyć doradztwo.`,
    };
  }
  if (entity.in_register === false && p >= LICENSE_RELEVANT) {
    const keys = [entity.domain && `domenie ${entity.domain}`, entity.nip && `NIP-ie ${entity.nip}`]
      .filter(Boolean)
      .join(" ani ");
    return {
      ...base,
      result: "violation",
      confidence: 0.85,
      reason: `Rejestr KNF nie zna podmiotu${keys ? ` o ${keys}` : ""} — brak zezwolenia na doradztwo inwestycyjne.`,
    };
  }
  return {
    ...base,
    result: "n/a",
    confidence: 0,
    reason:
      entity.in_register === null
        ? "Nie ustalono podmiotu w rejestrze KNF (brak domeny i NIP-u albo KNF nie odpowiedział)."
        : "Bez przesłanek doradztwa — zezwolenie nie ma znaczenia.",
  };
}

// Score'y reguł (risk score jak w M2, @/lib/analysis/risk) idą za score'em wyniku: werdykt
// `M3.advisory` dostaje score po rejestrze KNF, przesłanki podmiotu z zezwoleniem — × REGISTERED_FACTOR.
function scoreFlags(flags: readonly Flag[], score: number, registered: boolean): Flag[] {
  return flags.map((flag) => {
    if (flag.score === null) return flag;
    if (flag.rule_id === "M3.advisory") return { ...flag, score };
    return registered ? { ...flag, score: round(flag.score * REGISTERED_FACTOR) } : flag;
  });
}

export type AdvisoryVerdict = { score: number; label: string; flags: Flag[]; summary: string };

// Wynik modelu + rejestr KNF → score, etykieta i flaga `M3.license` (druga na liście).
export function applyRegistry(
  p: number,
  label: string,
  flags: readonly Flag[],
  entity: IncidentEntity,
  summary: string,
): AdvisoryVerdict {
  const license = licenseFlag(entity, p);
  const withLicense = license
    ? [
        ...flags.slice(0, 1),
        license,
        ...flags.slice(1).filter((f) => f.rule_id !== license.rule_id),
      ]
    : [...flags];
  if (entity.in_register && !entity.on_warning_list) {
    const score = round(p * REGISTERED_FACTOR);
    return {
      score,
      label: label === ADVISORY_POSITIVE ? ADVISORY_ALLOWED : label,
      flags: scoreFlags(withLicense, score, true),
      summary:
        label === ADVISORY_POSITIVE
          ? `${summary} Podmiot ma zezwolenie KNF — usługa dozwolona.`
          : summary,
    };
  }
  if (entity.on_warning_list) {
    const score = round(1 - (1 - p) * WARNING_FACTOR);
    return {
      score,
      label: ADVISORY_POSITIVE,
      flags: scoreFlags(withLicense, score, false),
      summary: `${summary} Podmiot jest na liście ostrzeżeń publicznych KNF.`,
    };
  }
  const unregistered = entity.in_register === false && p >= LICENSE_RELEVANT;
  return {
    score: round(p),
    label,
    flags: scoreFlags(withLicense, round(p), false),
    summary: unregistered ? `${summary} Brak podmiotu w rejestrze KNF.` : summary,
  };
}

function round(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
}
