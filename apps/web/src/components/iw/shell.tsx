"use client";

import {
  Inbox,
  LayoutDashboard,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  RadioTower,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import {
  sourceHasError,
  useEngine,
  useIncidents,
  useMe,
  useSources,
  useViolationCount,
} from "@/lib/client/api";
import { fmtTime, plural } from "@/lib/client/format";
import { RealtimeProvider, useRealtime } from "@/lib/client/realtime";
import { cn } from "@/lib/utils";
import { Avatar } from "./ui";

export const OPEN_STATUSES = ["new", "in_review"] as const;

// Zwinięty pasek: same ikony (56 px). Stan zapamiętany w przeglądarce.
const Collapsed = createContext(false);
const STORAGE_KEY = "iw-nav-collapsed";

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
  const collapsed = useContext(Collapsed);
  // "/" (Przegląd) tylko dokładnie — inaczej byłby aktywny na każdej podstronie.
  const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? (meta ? `${label} · ${meta}` : label) : undefined}
      className={cn(
        "relative flex h-9 items-center gap-2.5 rounded-md text-sm transition-colors duration-150",
        collapsed ? "justify-center px-0" : "px-2.5",
        active
          ? "bg-line-200/70 font-semibold text-ink-900"
          : "text-ink-700 hover:bg-surface-hover hover:text-ink-900",
      )}
    >
      <span className="text-ink-600">{icon}</span>
      {collapsed ? (
        meta ? (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-2 size-1.5 rounded-full bg-primary-700"
          />
        ) : null
      ) : (
        <>
          <span className="flex-1">{label}</span>
          {meta ? <span className="tnum font-normal text-ink-600 text-xs">{meta}</span> : null}
        </>
      )}
    </Link>
  );
}

// Panel „Na żywo”: zielona kropka przy połączeniu; przy błędzie źródła żółty wiersz i ramka
// (decyzja z 22.11, R9).
function LivePanel() {
  const { connected } = useRealtime();
  const collapsed = useContext(Collapsed);
  const engine = useEngine();
  const paused = engine.data?.paused ?? false;
  const sources = useSources();
  const items = sources.data?.items ?? [];
  const failed = items.filter(sourceHasError).length;
  const last = items
    .map((source) => source.lastScrapedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  if (collapsed) {
    return (
      <span
        title={`${connected ? "Na żywo" : "Bez połączenia na żywo"}${paused ? " · skanowanie wstrzymane" : ""}${failed ? ` · ${failed} źródeł z błędem` : ""}`}
        className="flex h-9 items-center justify-center"
      >
        <span
          className={cn(
            "size-2.5 rounded-full",
            failed || paused ? "bg-warning-700" : connected ? "bg-success-700" : "bg-ink-400",
          )}
        />
      </span>
    );
  }
  return (
    <div
      className={cn(
        "rounded-lg border bg-surface-0 p-3",
        failed || paused ? "border-warning-700" : "border-line-200",
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
      {paused ? (
        <Link
          href="/zrodla"
          className="mt-2 flex items-center gap-1.5 rounded-md bg-warning-100 px-2 py-1.5 font-medium text-warning-800 text-xs hover:underline"
        >
          <Pause className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          Skanowanie wstrzymane
        </Link>
      ) : null}
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

function CurrentUser() {
  const me = useMe();
  const collapsed = useContext(Collapsed);
  if (!me.data) return null;
  if (collapsed)
    return (
      <span title={me.data.name} className="flex justify-center">
        <Avatar reviewer={me.data} />
      </span>
    );
  return (
    <p className="flex items-center gap-2 px-1 text-[13px] text-ink-700">
      <Avatar reviewer={me.data} />
      <span className="truncate">
        {me.data.name}
        {me.data.role ? <span className="text-ink-600"> · {me.data.role}</span> : null}
      </span>
    </p>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  const collapsed = useContext(Collapsed);
  return (
    <section className="mt-5 flex flex-col gap-0.5" aria-label={label}>
      {collapsed ? (
        <hr className="mx-2 mb-2 border-line-200" />
      ) : (
        <p className="px-2.5 pb-1 font-medium text-ink-500 text-xs">{label}</p>
      )}
      {children}
    </section>
  );
}

function Nav({ onToggle }: { onToggle: () => void }) {
  const collapsed = useContext(Collapsed);
  const open = useViolationCount({ status: [...OPEN_STATUSES] });
  const ads = useIncidents({ module: ["finfluencer"], status: ["new"], page_size: 1 });
  const sources = useSources();
  const failed = (sources.data?.items ?? []).filter(sourceHasError).length;
  return (
    <nav
      aria-label="Główna"
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col border-line-200 border-r bg-surface-1 pt-5 pb-4 transition-[width] duration-150",
        collapsed ? "w-14 px-2" : "w-[220px] px-3",
      )}
    >
      <div className={cn("flex items-start gap-2", collapsed ? "justify-center" : "px-2.5")}>
        {collapsed ? null : (
          <div className="min-w-0 flex-1">
            <Image
              src={withBasePath("/ive-logo.svg")}
              alt="IVE — Investor Vigilance Engine"
              width={286}
              height={84}
              unoptimized
              priority
              className="h-auto w-full"
            />
            <p className="mt-1.5 text-ink-600 text-xs">UKNF · nadzór marketingu</p>
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Rozwiń pasek" : "Zwiń pasek"}
          title={collapsed ? "Rozwiń pasek" : "Zwiń pasek"}
          className="focus-visible:focus-ring flex size-8 items-center justify-center rounded-md text-ink-600 hover:bg-surface-hover hover:text-ink-900"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" strokeWidth={1.5} />
          ) : (
            <PanelLeftClose className="size-4" strokeWidth={1.5} />
          )}
        </button>
      </div>
      {/* Nawigacja w grupach: start dnia, praca z wykryciami, ustawienia systemu. */}
      <div className="mt-6 flex flex-col gap-0.5">
        <NavItem
          href="/"
          label="Przegląd"
          icon={<LayoutDashboard className="size-4" strokeWidth={1.5} />}
        />
      </div>
      <NavGroup label="Wykrycia">
        <NavItem
          href="/kolejka"
          label="Naruszenia"
          icon={<Inbox className="size-4" strokeWidth={1.5} />}
          meta={open !== undefined ? String(open) : undefined}
        />
        <NavItem
          href="/reklamy"
          label="Reklamy"
          icon={<Megaphone className="size-4" strokeWidth={1.5} />}
          meta={ads.data?.total ? String(ads.data.total) : undefined}
        />
      </NavGroup>
      <NavGroup label="System">
        <NavItem
          href="/zrodla"
          label="Źródła"
          icon={<RadioTower className="size-4" strokeWidth={1.5} />}
          meta={failed ? `${failed} ${plural(failed, "błąd", "błędy", "błędów")}` : undefined}
        />
        <NavItem
          href="/kalibracja"
          label="Kalibracja"
          icon={<SlidersHorizontal className="size-4" strokeWidth={1.5} />}
        />
      </NavGroup>
      <div className="mt-auto flex flex-col gap-3">
        <LivePanel />
        <CurrentUser />
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {}
  }, []);
  function toggle() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(STORAGE_KEY, value ? "0" : "1");
      } catch {}
      return !value;
    });
  }
  return (
    <RealtimeProvider>
      <div className="flex h-full min-h-screen">
        <Collapsed.Provider value={collapsed}>
          <Nav onToggle={toggle} />
        </Collapsed.Provider>
        <main className="min-w-0 flex-1 overflow-y-auto px-8 pt-6 pb-10">{children}</main>
      </div>
    </RealtimeProvider>
  );
}
