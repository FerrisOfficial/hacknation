"use client";

import type { IncidentEntity } from "@/lib/incidents/contract";
import { OutlineChip, Tip } from "./ui";

// Chip rejestru KNF z tooltipem wyjaśniającym termin (R14).
export function RegistryChip({
  entity,
}: {
  entity: Pick<IncidentEntity, "in_register" | "knf_id" | "on_warning_list">;
}) {
  if (entity.in_register === null && !entity.on_warning_list) return null;
  return (
    <span className="flex flex-wrap gap-2">
      {entity.in_register !== null ? (
        <Tip
          label={
            entity.in_register
              ? `Firma jest w rejestrze podmiotów nadzorowanych przez KNF${entity.knf_id ? ` (nr ${entity.knf_id})` : ""}.`
              : "Firmy nie ma w rejestrze KNF. Może nie mieć zezwolenia na usługi inwestycyjne w Polsce."
          }
        >
          <OutlineChip>{entity.in_register ? "w rejestrze KNF" : "spoza rejestru KNF"}</OutlineChip>
        </Tip>
      ) : null}
      {entity.on_warning_list ? (
        <Tip label="Firma jest na liście ostrzeżeń publicznych KNF.">
          <OutlineChip className="border-risk-700 text-risk-700">lista ostrzeżeń KNF</OutlineChip>
        </Tip>
      ) : null}
    </span>
  );
}
