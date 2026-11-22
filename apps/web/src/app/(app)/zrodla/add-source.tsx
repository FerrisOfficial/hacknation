"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button, Card, SectionTitle } from "@/components/iw/ui";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { useCreateSource } from "@/lib/client/api";
import { type SourceAddForm, sourceAddFormSchema, sourceAddToCreate } from "@/lib/schemas";

export const INTERVAL_OPTIONS: { value: SourceAddForm["interval"]; label: string }[] = [
  { value: "15", label: "co 15 min" },
  { value: "60", label: "co godzinę" },
  { value: "360", label: "co 6 h" },
  { value: "720", label: "co 12 h" },
  { value: "1440", label: "raz dziennie" },
  { value: "manual", label: "tylko ręcznie" },
];

const control =
  "h-9 w-full rounded-md border border-ink-400 bg-surface-0 px-3 text-ink-900 text-sm placeholder:text-ink-500 aria-invalid:border-risk-700";

// Dodawanie źródła (Z1): w tej wersji fraza YouTube albo strona WWW, z harmonogramem pobierania.
export function AddSource({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const create = useCreateSource();
  const form = useForm<SourceAddForm>({
    resolver: zodResolver(sourceAddFormSchema),
    defaultValues: { kind: "youtube_search", target: "", name: "", interval: "60" },
  });
  const kind = form.watch("kind");
  const errors = form.formState.errors;

  if (!open) return null;

  return (
    <Card className="w-full p-4">
      <div className="flex items-center justify-between">
        <SectionTitle>Nowe źródło</SectionTitle>
        <button
          type="button"
          aria-label="Zamknij formularz"
          onClick={() => setOpen(false)}
          className="inline-flex size-8 items-center justify-center rounded-md text-ink-600 hover:bg-surface-hover"
        >
          <X className="size-4" strokeWidth={1.5} />
        </button>
      </div>
      <form
        noValidate
        onSubmit={form.handleSubmit((values) =>
          create.mutate(sourceAddToCreate(values), {
            onSuccess: () => {
              toast.success("Dodano źródło. Pierwsze pobranie już trwa.");
              form.reset();
              setOpen(false);
            },
            onError: (error) => toast.error(error.message),
          }),
        )}
        className="mt-3"
      >
        <div className="grid grid-cols-[200px_minmax(0,1fr)_240px_200px] items-start gap-3">
          <Field>
            <FieldLabel htmlFor="source-kind">Typ</FieldLabel>
            <select id="source-kind" className={control} {...form.register("kind")}>
              <option value="youtube_search">Fraza w YouTube</option>
              <option value="web_page">Strona WWW</option>
            </select>
          </Field>
          <Field data-invalid={Boolean(errors.target)}>
            <FieldLabel htmlFor="source-target">
              {kind === "web_page" ? "Adres strony" : "Fraza do wyszukania"}
            </FieldLabel>
            <input
              id="source-target"
              className={control}
              placeholder={
                kind === "web_page" ? "https://firma.pl/oferta" : "np. kod polecający XTB"
              }
              aria-invalid={Boolean(errors.target)}
              {...form.register("target")}
            />
            <FieldError errors={[errors.target]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="source-name">Nazwa (opcjonalnie)</FieldLabel>
            <input
              id="source-name"
              className={control}
              placeholder="np. YouTube: kody polecające"
              {...form.register("name")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="source-interval">Jak często skanować</FieldLabel>
            <select id="source-interval" className={control} {...form.register("interval")}>
              {INTERVAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={create.isPending}>
            Dodaj i pobierz teraz
          </Button>
          <Button onClick={() => setOpen(false)}>Anuluj</Button>
          <p className="text-[13px] text-ink-600">
            Instagram, Facebook i TikTok nie są zbierane w tej wersji.
          </p>
        </div>
      </form>
    </Card>
  );
}
