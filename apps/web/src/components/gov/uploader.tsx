"use client";

// Uploader Gov.pl (kit w Figmie: strona „Formularze”): przeciągnij pliki albo „Dodaj pliki z dysku”.
import { cn } from "cn";
import { FileIcon, UploadIcon, XIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export type UploadItem = {
  id: string;
  file: File;
  /** 0–100 przy wysyłaniu na serwer; undefined = tylko w pamięci przeglądarki. */
  progress?: number;
  error?: string;
};

function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1
    ? `${mb.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} MB`
    : `${Math.ceil(bytes / 1024)} kB`;
}

export function Uploader({
  items,
  onAdd,
  onRemove,
  accept,
  hint = "PDF, JPG lub PNG, maks. 10 MB",
  disabled,
  label = "Załączniki",
}: {
  items: UploadItem[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  accept?: string;
  hint?: string;
  disabled?: boolean;
  label?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{label}</p>
      <section
        aria-label={label}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled) onAdd(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded border border-dashed border-input px-6 py-8 text-center",
          dragOver && "border-2 border-primary bg-muted",
          disabled && "bg-muted text-text-disabled",
        )}
      >
        <UploadIcon
          className={cn("size-8", disabled ? "text-disabled" : "text-primary")}
          aria-hidden="true"
        />
        <p>Przeciągnij pliki tutaj lub</p>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Dodaj pliki z dysku
        </Button>
        <p className="text-sm text-muted-foreground">{hint}</p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={accept}
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            onAdd(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </section>
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={cn(
                "flex flex-col gap-2 rounded border p-3",
                item.error ? "border-danger" : "border-border",
              )}
            >
              <div className="flex items-center gap-3">
                <FileIcon className="size-5 shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate text-sm text-text-link">
                  {item.file.name} ({formatSize(item.file.size)})
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Usuń plik ${item.file.name}`}
                  onClick={() => onRemove(item.id)}
                >
                  <XIcon />
                </Button>
              </div>
              {item.progress !== undefined && !item.error && (
                <Progress value={item.progress} aria-label={`Wysyłanie ${item.file.name}`} />
              )}
              {item.error && <p className="text-sm text-danger">{item.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
