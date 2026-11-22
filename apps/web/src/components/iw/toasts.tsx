"use client";

import { BellRing, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { fmtScore, MODULE_SHORT } from "@/lib/client/format";
import type { HighRiskIncidentEvent } from "@/lib/incidents/contract";

// Toast decyzji i toast alertu (kontrakt UI): tło ink-900, biały tekst, znika po 10 s,
// najechanie zatrzymuje odliczanie (sonner), nie zabiera fokusu.

export function showDecisionToast(text: string, onUndo: () => void) {
  toast.custom(
    (id) => (
      <div className="flex w-[380px] items-center gap-3 rounded-lg bg-ink-900 px-4 py-3 text-sm text-white shadow-lg">
        <span className="min-w-0 flex-1">{text}</span>
        <button
          type="button"
          onClick={() => {
            onUndo();
            toast.dismiss(id);
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/40 px-2.5 font-medium text-xs hover:bg-white/10"
        >
          <Undo2 className="size-4" strokeWidth={1.5} aria-hidden="true" />
          Cofnij
          <span className="text-white/70">Ctrl+Z</span>
        </button>
      </div>
    ),
    { duration: 10_000 },
  );
}

export function showAlertToast(event: HighRiskIncidentEvent, onOpen: () => void) {
  toast.custom(
    (id) => (
      <div className="flex w-[460px] items-center gap-3 overflow-hidden rounded-lg bg-ink-900 py-3 pr-3 pl-0 text-white shadow-lg">
        <span className="h-10 w-1 shrink-0 rounded-r bg-risk-700" aria-hidden="true" />
        <BellRing className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-sm">
            Wysokie ryzyko · {fmtScore(event.score)} · {MODULE_SHORT[event.module]}
          </span>
          <span className="block truncate text-[13px] text-white/80">
            {event.summary || event.url}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            onOpen();
            toast.dismiss(id);
          }}
          className="inline-flex h-8 items-center rounded-md border border-white/40 px-3 font-medium text-xs hover:bg-white/10"
        >
          Otwórz
        </button>
      </div>
    ),
    { duration: 10_000 },
  );
}
