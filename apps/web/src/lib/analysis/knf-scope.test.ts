import { describe, expect, it } from "vitest";
import { inKnfScope, KNF_SCOPED_MODULES, requiresKnfRegister } from "./knf-scope";

describe("inKnfScope", () => {
  it("M1 i M2 tylko dla podmiotu z wpisem w rejestrze KNF", () => {
    for (const module of ["finfluencer", "risk_disclosure"] as const) {
      expect(inKnfScope(module, { in_register: true })).toBe(true);
      // Podmiot znany, ale bez wpisu w rejestrze usług inwestycyjnych, albo nieznany KNF.
      expect(inKnfScope(module, { in_register: false })).toBe(false);
      // Brak domeny i NIP-u (nie ma czego szukać) albo KNF nie odpowiedział.
      expect(inKnfScope(module, { in_register: null })).toBe(false);
    }
  });

  it("M3 szuka podmiotów bez zezwolenia, więc analizuje każdy materiał", () => {
    expect(inKnfScope("unauthorized_advisory", { in_register: false })).toBe(true);
    expect(inKnfScope("unauthorized_advisory", { in_register: null })).toBe(true);
    expect(inKnfScope("unauthorized_advisory", { in_register: true })).toBe(true);
    expect(requiresKnfRegister("unauthorized_advisory")).toBe(false);
  });

  it("lista modułów z wymogiem rejestru to M1 i M2", () => {
    expect([...KNF_SCOPED_MODULES]).toEqual(["finfluencer", "risk_disclosure"]);
  });
});
