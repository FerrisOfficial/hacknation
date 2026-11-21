"use client";

import { Inbox, LayoutDashboard, RadioTower, SlidersHorizontal, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { sourceHasError, useIncidents, useSources } from "@/lib/client/api";
import { fmtTime, plural } from "@/lib/client/format";
import { RealtimeProvider, useRealtime } from "@/lib/client/realtime";
import { cn } from "@/lib/utils";

export const OPEN_STATUSES = ["new", "in_review"] as const;

function NavItem({
  href,
  icon,
  label,
  meta,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  meta?: string;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-150",
        active
          ? "bg-line-200/70 font-semibold text-ink-900"
          : "text-ink-700 hover:bg-surface-hover hover:text-ink-900",
      )}
    >
      <span className="text-ink-600">{icon}</span>
      <span className="flex-1">{label}</span>
      {meta ? <span className="tnum font-normal text-ink-600 text-xs">{meta}</span> : null}
    </Link>
  );
}

// Panel „Na żywo”: zielona kropka przy połączeniu; przy błędzie źródła żółty wiersz i ramka
// (decyzja z 22.11, R9).
function LivePanel() {
  const { connected } = useRealtime();
  const sources = useSources();
  const items = sources.data?.items ?? [];
  const failed = items.filter(sourceHasError).length;
  const last = items
    .map((source) => source.lastScrapedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  return (
    <div
      className={cn(
        "rounded-lg border bg-surface-0 p-3",
        failed ? "border-warning-700" : "border-line-200",
      )}
    >
      <p className="flex items-center gap-2 font-medium text-[13px] text-ink-900">
        <span
          aria-hidden="true"
          className={cn("size-2 rounded-full", connected ? "bg-success-700" : "bg-ink-400")}
        />
        {connected ? "Na żywo" : "Bez połączenia na żywo"}
      </p>
      <p className="mt-1 text-ink-600 text-xs">
        {last ? `ostatnie pobranie ${fmtTime(last)}` : "brak pobrań"}
      </p>
      {failed ? (
        <Link
          href="/zrodla"
          className="mt-2 flex items-center gap-1.5 rounded-md bg-warning-100 px-2 py-1.5 font-medium text-warning-800 text-xs hover:underline"
        >
          <TriangleAlert className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          {failed} {plural(failed, "źródło z błędem", "źródła z błędem", "źródeł z błędem")}
        </Link>
      ) : null}
    </div>
  );
}

function Nav() {
  const open = useIncidents({ status: [...OPEN_STATUSES], page_size: 1 });
  const sources = useSources();
  const failed = (sources.data?.items ?? []).filter(sourceHasError).length;
  return (
    <nav
      aria-label="Główna"
      className="flex w-[220px] shrink-0 flex-col border-line-200 border-r bg-surface-1 px-3 pt-5 pb-4"
    >
      <div className="px-2.5">
        <p className="font-semibold text-[15px] text-ink-900">InvestWatch</p>
        <p className="text-ink-600 text-xs">UKNF · nadzór marketingu</p>
      </div>
      <div className="mt-6 flex flex-col gap-0.5">
        <NavItem
          href="/przeglad"
          label="Przegląd"
          icon={<LayoutDashboard className="size-4" strokeWidth={1.5} />}
        />
        <NavItem
          href="/kolejka"
          label="Kolejka"
          icon={<Inbox className="size-4" strokeWidth={1.5} />}
          meta={open.data ? String(open.data.total) : undefined}
        />
        <NavItem
          href="/kalibracja"
          label="Kalibracja"
          icon={<SlidersHorizontal className="size-4" strokeWidth={1.5} />}
        />
        <NavItem
          href="/zrodla"
          label="Źródła"
          icon={<RadioTower className="size-4" strokeWidth={1.5} />}
          meta={failed ? `${failed} ${plural(failed, "błąd", "błędy", "błędów")}` : undefined}
        />
      </div>
      <div className="mt-auto">
        <LivePanel />
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider>
      <div className="flex h-full min-h-screen">
        <Nav />
        <main className="min-w-0 flex-1 overflow-y-auto px-8 pt-6 pb-10">{children}</main>
      </div>
    </RealtimeProvider>
  );
}
