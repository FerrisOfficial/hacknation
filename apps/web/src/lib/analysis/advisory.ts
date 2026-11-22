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
    return {
      score: round(p * REGISTERED_FACTOR),
      label: label === ADVISORY_POSITIVE ? ADVISORY_ALLOWED : label,
      flags: withLicense,
      summary:
        label === ADVISORY_POSITIVE
          ? `${summary} Podmiot ma zezwolenie KNF — usługa dozwolona.`
          : summary,
    };
  }
  if (entity.on_warning_list) {
    return {
      score: round(1 - (1 - p) * WARNING_FACTOR),
      label: ADVISORY_POSITIVE,
      flags: withLicense,
      summary: `${summary} Podmiot jest na liście ostrzeżeń publicznych KNF.`,
    };
  }
  const unregistered = entity.in_register === false && p >= LICENSE_RELEVANT;
  return {
    score: round(p),
    label,
    flags: withLicense,
    summary: unregistered ? `${summary} Brak podmiotu w rejestrze KNF.` : summary,
  };
}

function round(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
}
