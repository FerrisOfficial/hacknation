"use client";

// Struktury i nawigacja Gov.pl (kit w Figmie: strony „Struktury” i „Nawigacja”).
// Logotypy to sloty: wstaw oficjalne pliki instytucji zgodnie z zasadami ich użycia.
import { cn } from "cn";
import { ChevronDownIcon, MenuIcon, XIcon } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export type NavItem = { label: string; href: string; active?: boolean };

/** Górna belka: logo instytucji, czerwony separator, nazwa serwisu, akcje po prawej. */
export function GovHeader({
  serviceName,
  logo,
  actions,
  onMenuClick,
}: {
  serviceName: string;
  logo: React.ReactNode;
  actions?: React.ReactNode;
  onMenuClick?: () => void;
}) {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-18 max-w-292 items-center gap-5 px-4 md:h-24 md:px-6">
        {onMenuClick && (
          <Button size="icon" aria-label="Otwórz menu" onClick={onMenuClick}>
            <MenuIcon />
          </Button>
        )}
        <Link href="/" className="shrink-0 rounded-sm focus-visible:focus-ring">
          {logo}
        </Link>
        <span aria-hidden="true" className="h-9 w-0.5 bg-danger md:h-12" />
        <span className="min-w-0 flex-1 text-sm font-semibold md:text-base">{serviceName}</span>
        {actions && <div className="hidden md:block">{actions}</div>}
      </div>
    </header>
  );
}

/** Menu poziome: 2–7 odnośników (max 3 słowa), wyrównane do prawej. Mobile: przycisk MENU. */
export function HorizontalMenu({ siteName, items }: { siteName: string; items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <nav aria-label="Menu główne" className="border-b border-border bg-background">
      <div className="mx-auto flex min-h-16 max-w-292 flex-wrap items-center gap-6 px-4 md:px-6">
        <span className="flex-1 text-xl font-bold">{siteName}</span>
        <Button
          variant="secondary"
          size="sm"
          className="md:hidden"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          Menu
        </Button>
        <ul
          className={cn(
            "w-full flex-col md:flex md:w-auto md:flex-row md:gap-8 md:self-stretch",
            open ? "flex pb-4" : "hidden",
          )}
        >
          {items.map((item) => (
            <li key={item.href} className="flex">
              <Link
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                className={cn(
                  "flex items-center border-b-3 border-transparent py-3 font-semibold text-primary hover:text-primary-hover focus-visible:focus-ring",
                  item.active && "border-primary text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/** Menu boczne: strony tego samego poziomu, bez zagnieżdżeń. Ukryj poniżej 700 px. */
export function SideMenu({ items, label = "Menu sekcji" }: { items: NavItem[]; label?: string }) {
  return (
    <nav aria-label={label} className="w-70 max-md:hidden">
      <ul className="border-t border-border">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "block border-b border-border px-4 py-3 text-primary hover:bg-muted focus-visible:focus-ring",
                item.active &&
                  "bg-gov-secondary font-semibold text-primary-foreground hover:bg-gov-secondary",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Hamburger menu: panel przy lewej krawędzi do przechodzenia między serwisami portalu. */
export function HamburgerMenu({
  open,
  onClose,
  items,
  tone = "gray",
}: {
  open: boolean;
  onClose: () => void;
  items: (NavItem & { children?: NavItem[] })[];
  tone?: "gray" | "blue";
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!open) return null;
  const dark = tone === "blue";
  return (
    <div
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-80 flex-col py-4 shadow-lg",
        dark ? "bg-gov-secondary text-primary-foreground" : "bg-muted text-foreground",
      )}
    >
      <div className="flex items-center px-6 pb-4">
        <span className="flex-1 text-xl font-bold">Menu</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zamknij menu"
          className={cn(dark && "text-primary-foreground hover:text-primary-foreground")}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      <nav aria-label="Serwisy portalu">
        <ul>
          {items.map((item) => (
            <li key={item.href}>
              <div
                className={cn(
                  "flex items-center",
                  item.active && (dark ? "bg-primary" : "bg-background"),
                )}
              >
                <Link
                  href={item.href}
                  aria-current={item.active ? "page" : undefined}
                  className={cn(
                    "flex-1 px-6 py-3.5 focus-visible:focus-ring",
                    item.active
                      ? "font-semibold"
                      : dark
                        ? "text-primary-foreground"
                        : "text-primary",
                  )}
                >
                  {item.label}
                </Link>
                {item.children && (
                  <button
                    type="button"
                    aria-expanded={expanded === item.href}
                    aria-label={`Rozwiń: ${item.label}`}
                    className="px-6 py-3.5 focus-visible:focus-ring"
                    onClick={() => setExpanded((v) => (v === item.href ? null : item.href))}
                  >
                    <ChevronDownIcon
                      className={cn(
                        "size-4 transition-transform",
                        expanded === item.href && "rotate-180",
                      )}
                    />
                  </button>
                )}
              </div>
              {item.children && expanded === item.href && (
                <ul className="pb-2">
                  {item.children.map((child) => (
                    <li key={child.href}>
                      <Link
                        href={child.href}
                        className={cn(
                          "block py-2.5 pr-6 pl-10 text-sm focus-visible:focus-ring",
                          dark ? "text-primary-foreground" : "text-primary",
                        )}
                      >
                        {child.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** Stopka witryny: nazwa i opis serwisu, linki obowiązkowe, copyright. */
export function SiteFooter({
  serviceName,
  description,
  links,
  owner,
}: {
  serviceName: string;
  description: string;
  links: NavItem[];
  owner: string;
}) {
  return (
    <footer className="bg-muted">
      <div className="mx-auto flex max-w-292 flex-col gap-8 px-4 py-10 md:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:gap-18">
          <div className="flex max-w-90 flex-col gap-2">
            <p className="text-xl font-bold">{serviceName}</p>
            <p className="text-sm">{description}</p>
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="text-text-link underline underline-offset-2 hover:text-primary-hover focus-visible:focus-ring"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <p className="border-t border-input pt-4 text-xs text-muted-foreground">
          © {new Date().getFullYear()} {owner}
        </p>
      </div>
    </footer>
  );
}

/** Stopka Gov.pl (formalno-prawna): logo portalu, RODO, licencja, logotypy UE. */
export function GovPortalFooter({
  portalLogo,
  rodo,
  license,
  links,
  euLogos,
}: {
  portalLogo: React.ReactNode;
  rodo: React.ReactNode;
  license: React.ReactNode;
  links: NavItem[];
  euLogos?: React.ReactNode;
}) {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex max-w-292 flex-col gap-6 px-4 py-8 md:px-6">
        <div className="flex flex-col gap-5 md:flex-row md:gap-12">
          <Link href="/" className="shrink-0 rounded-sm focus-visible:focus-ring">
            {portalLogo}
          </Link>
          <div className="flex flex-col gap-2 text-sm">
            <div>{rodo}</div>
            <div>{license}</div>
            <ul className="flex flex-wrap gap-x-5 gap-y-1">
              {links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-text-link underline underline-offset-2 hover:text-primary-hover focus-visible:focus-ring"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {euLogos && <div className="flex flex-col gap-4 md:flex-row">{euLogos}</div>}
      </div>
    </footer>
  );
}
