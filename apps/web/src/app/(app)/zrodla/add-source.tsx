"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/iw/ui";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { type SourceItem, useCreateSource, useUpdateSource } from "@/lib/client/api";
import {
  isoToLocal,
  localToIso,
  type SourceAddForm,
  sourceAddFormSchema,
  sourceAddToCreate,
} from "@/lib/schemas";

export const INTERVAL_OPTIONS: { value: SourceAddForm["interval"]; label: string }[] = [
  { value: "15", label: "co 15 min" },
  { value: "60", label: "co godzinę" },
  { value: "360", label: "co 6 h" },
  { value: "720", label: "co 12 h" },
  { value: "1440", label: "raz dziennie" },
  { value: "manual", label: "tylko ręcznie" },
];

const control =
  "h-9 w-full rounded-md border border-ink-400 bg-surface-0 px-3 text-ink-900 text-sm placeholder:text-ink-500 disabled:bg-surface-1 disabled:text-ink-600 aria-invalid:border-risk-700";

// Okno modalne w stylu UI kitu: tytuł, zamknięcie (×, Esc, klik w tło), treść, stopka z akcjami.
export function Modal({
  open,
  onClose,
  title,
  children,
  width = "w-[560px]",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      className={`${width} m-auto max-w-[calc(100vw-32px)] rounded-xl border border-line-200 bg-surface-0 p-0 text-ink-900 shadow-xl backdrop:bg-ink-900/40`}
    >
      {open ? (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-[17px]">{title}</h2>
            <button
              type="button"
              aria-label="Zamknij"
              onClick={onClose}
              className="focus-visible:focus-ring inline-flex size-8 items-center justify-center rounded-md text-ink-600 hover:bg-surface-hover"
            >
              <X className="size-4" strokeWidth={1.5} />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

function formFor(source: SourceItem | null): SourceAddForm {
  if (!source) {
    return { kind: "youtube_search", target: "", name: "", interval: "60", scheduledAt: "" };
  }
  const interval = INTERVAL_OPTIONS.some((o) => o.value === String(source.intervalMinutes))
    ? (String(source.intervalMinutes) as SourceAddForm["interval"])
    : source.intervalMinutes === null
      ? "manual"
      : "1440";
  return {
    kind: source.config.kind === "web_page" ? "web_page" : "youtube_search",
    target:
      source.config.kind === "youtube_search"
        ? source.config.query
        : source.config.kind === "youtube_channel"
          ? source.config.channelUrl
          : source.url,
    name: source.name,
    interval,
    scheduledAt: isoToLocal(source.scheduledAt),
  };
}

// Nowe źródło albo edycja istniejącego (source != null). Kanał YouTube ma stały adres.
export function SourceDialog({
  open,
  source,
  onClose,
}: {
  open: boolean;
  source: SourceItem | null;
  onClose: () => void;
}) {
  const create = useCreateSource();
  const update = useUpdateSource();
  const form = useForm<SourceAddForm>({
    resolver: zodResolver(sourceAddFormSchema),
    defaultValues: formFor(source),
  });
  useEffect(() => {
    if (open) form.reset(formFor(source));
  }, [open, source, form]);
  const kind = form.watch("kind");
  const errors = form.formState.errors;
  const channel = source?.config.kind === "youtube_channel";
  const pending = create.isPending || update.isPending;

  function submit(values: SourceAddForm) {
    if (!source) {
      create.mutate(sourceAddToCreate(values), {
        onSuccess: () => {
          toast.success(
            values.scheduledAt
              ? "Dodano źródło. Pobranie zaplanowane."
              : "Dodano źródło. Pierwsze pobranie już trwa.",
          );
          onClose();
        },
        onError: (error) => toast.error(error.message),
      });
      return;
    }
    const start = formFor(source);
    const target =
      channel || values.target === start.target
        ? {}
        : source.config.kind === "youtube_search"
          ? { query: values.target }
          : { url: values.target };
    update.mutate(
      {
        id: source.id,
        name: values.name || source.name,
        intervalMinutes: values.interval === "manual" ? null : Number(values.interval),
        scheduledAt: localToIso(values.scheduledAt) ?? null,
        ...target,
      },
      {
        onSuccess: () => {
          toast.success(`Zapisano: ${values.name || source.name}`);
          onClose();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={source ? "Edytuj źródło" : "Nowe źródło"}>
      <form noValidate onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="source-kind">Typ</FieldLabel>
          <select
            id="source-kind"
            className={control}
            disabled={Boolean(source)}
            {...form.register("kind")}
          >
            <option value="youtube_search">Fraza w YouTube</option>
            <option value="web_page">Strona WWW</option>
            {channel ? <option value="youtube_search">Kanał YouTube</option> : null}
          </select>
        </Field>
        <Field data-invalid={Boolean(errors.target)}>
          <FieldLabel htmlFor="source-target">
            {channel ? "Kanał" : kind === "web_page" ? "Adres strony" : "Fraza do wyszukania"}
          </FieldLabel>
          <input
            id="source-target"
            className={control}
            disabled={channel}
            placeholder={kind === "web_page" ? "https://firma.pl/oferta" : "np. kod polecający XTB"}
            aria-invalid={Boolean(errors.target)}
            {...form.register("target")}
          />
          <FieldError errors={[errors.target]} />
        </Field>
        <Field>
          <FieldLabel htmlFor="source-name">Nazwa{source ? "" : " (opcjonalnie)"}</FieldLabel>
          <input
            id="source-name"
            className={control}
            placeholder="np. YouTube: kody polecające"
            {...form.register("name")}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
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
          <Field>
            <FieldLabel htmlFor="source-scheduled">Zaplanuj pobranie</FieldLabel>
            <input
              id="source-scheduled"
              type="datetime-local"
              className={control}
              {...form.register("scheduledAt")}
            />
            <FieldDescription className="text-xs">
              Puste: {source ? "bez planu" : "pobierz od razu"}. Harmonogram rusza od tej chwili.
            </FieldDescription>
          </Field>
        </div>
        <div className="mt-1 flex items-center justify-end gap-2 border-line-200 border-t pt-4">
          <Button onClick={onClose}>Anuluj</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {source ? "Zapisz" : "Dodaj"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
