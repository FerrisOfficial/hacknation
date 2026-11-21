// Komponenty treści Gov.pl spoza shadcn (kit w Figmie: strona „Treść”).
import { cn } from "cn";
import { ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import type * as React from "react";

/** Odnośnik = nawigacja (akcja = Button). Etykieta jednoznaczna, bez „więcej” i „kliknij tutaj”. */
export function TextLink({
  className,
  external,
  children,
  ...props
}: React.ComponentProps<typeof Link> & { external?: boolean }) {
  const linkClass = cn(
    "inline-flex items-center gap-1 rounded-sm text-text-link underline-offset-2 hover:text-primary-hover hover:underline focus-visible:focus-ring",
    className,
  );
  if (external) {
    return (
      <Link className={linkClass} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
        <ExternalLinkIcon className="size-4" aria-hidden="true" />
        <span className="sr-only">(otwiera się w nowym oknie)</span>
      </Link>
    );
  }
  return (
    <Link className={linkClass} {...props}>
      {children}
    </Link>
  );
}

/** Licznik znaków pod polem tekstowym. Przekroczony limit = kolor danger. */
export function CharCounter({ value, max }: { value: number; max: number }) {
  const fmt = new Intl.NumberFormat("pl-PL");
  return (
    <p
      className={cn("text-right text-sm", value > max ? "text-danger" : "text-foreground")}
      aria-live="polite"
    >
      {fmt.format(value)} / {fmt.format(max)}
    </p>
  );
}

/** Baner produktowy: treść + zdjęcie (zamiennie stronami). */
export function ProductBanner({
  title,
  children,
  image,
  imageSide = "right",
  action,
}: {
  title: string;
  children: React.ReactNode;
  image: React.ReactNode;
  imageSide?: "left" | "right";
  action?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded bg-muted md:flex-row",
        imageSide === "left" && "md:flex-row-reverse",
      )}
    >
      <div className="flex flex-1 flex-col gap-4 p-6 md:p-10">
        <h2 className="text-2xl leading-tight font-bold">{title}</h2>
        <div className="text-base">{children}</div>
        {action ? <div>{action}</div> : null}
      </div>
      <div className="min-h-48 md:w-1/2">{image}</div>
    </section>
  );
}

/** Odnośnik do Biuletynu Informacji Publicznej. Podmień logo na oficjalny plik. */
export function BipLink({ href, logo }: { href: string; logo?: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-3 rounded-sm text-text-link underline underline-offset-2 hover:text-primary-hover focus-visible:focus-ring"
    >
      {logo}
      Biuletyn Informacji Publicznej
    </a>
  );
}
