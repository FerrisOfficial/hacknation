"use client";

import { BellRing, Megaphone, Undo2, X } from "lucide-react";
import { toast, useSonner } from "sonner";
import { fmtScore, MODULE_NAME } from "@/lib/client/format";
import type { HighRiskIncidentEvent } from "@/lib/incidents/contract";

// Toast decyzji i toast alertu (kontrakt UI): tło ink-900, biały tekst, znika po 10 s,
// najechanie zatrzymuje odliczanie (sonner), nie zabiera fokusu. Każdy ma ×, a przy kilku
// powiadomieniach także „Zamknij wszystkie”.

function CloseButton({ id }: { id: string | number }) {
  return (
    <button
      type="button"
      aria-label="Zamknij powiadomienie"
      onClick={() => toast.dismiss(id)}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
    >
      <X className="size-4" strokeWidth={1.5} />
    </button>
  );
}

function DismissAll() {
  const { toasts } = useSonner();
  if (toasts.length < 2) return null;
  return (
    <button
      type="button"
      onClick={() => toast.dismiss()}
      className="font-medium text-white/70 text-xs underline-offset-2 hover:text-white hover:underline"
    >
      Zamknij wszystkie ({toasts.length})
    </button>
  );
}

export function showDecisionToast(text: string, onUndo: () => void) {
  toast.custom(
    (id) => (
      <div className="flex w-[420px] items-center gap-3 rounded-lg bg-ink-900 py-3 pr-2 pl-4 text-sm text-white shadow-lg">
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
        <CloseButton id={id} />
      </div>
    ),
    { duration: 10_000 },
  );
}

// Alert z Socket.io. Moduł 1 to wykryta reklama, nie naruszenie (R18): bez paska ryzyka.
export function showAlertToast(event: HighRiskIncidentEvent, onOpen: () => void) {
  const ads = event.module === "finfluencer";
  toast.custom(
    (id) => (
      <div className="flex w-[480px] items-center gap-3 overflow-hidden rounded-lg bg-ink-900 py-3 pr-2 pl-0 text-white shadow-lg">
        <span
          className={`h-10 w-1 shrink-0 rounded-r ${ads ? "bg-ink-500" : "bg-risk-700"}`}
          aria-hidden="true"
        />
        {ads ? (
          <Megaphone className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <BellRing className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-sm">
            {ads
              ? `Nowa reklama osoby trzeciej · pewność ${fmtScore(event.score)}`
              : `Wysokie ryzyko · ${fmtScore(event.score)} · ${MODULE_NAME[event.module].toLowerCase()}`}
          </span>
          <span className="block truncate text-[13px] text-white/80">
            {event.summary || event.url}
          </span>
          <DismissAll />
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
        <CloseButton id={id} />
      </div>
    ),
    { duration: 10_000 },
  );
}
