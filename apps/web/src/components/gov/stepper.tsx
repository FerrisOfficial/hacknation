// Stepper procesu Gov.pl (kit w Figmie: strona „Nawigacja”). Optymalnie 3–5 kroków, max 6–7.
import { cn } from "cn";
import { CheckIcon } from "lucide-react";

export type StepStatus = "completed" | "current" | "enabled" | "disabled" | "error";

export type Step = { label: string; status: StepStatus };

const statusText: Record<StepStatus, string> = {
  completed: "ukończony",
  current: "bieżący",
  enabled: "dostępny",
  disabled: "niedostępny",
  error: "wymaga poprawy",
};

/**
 * Standardowy stepper: można wrócić tylko do ukończonych kroków (onSelect dostaje indeks),
 * dalej wyłącznie przyciskami formularza.
 */
export function Stepper({
  steps,
  onSelect,
  className,
}: {
  steps: Step[];
  onSelect?: (index: number) => void;
  className?: string;
}) {
  return (
    <ol className={cn("flex list-none overflow-x-auto pt-2 pb-3 pl-1", className)}>
      {steps.map((step, i) => {
        const clickable = onSelect && (step.status === "completed" || step.status === "enabled");
        const isLast = i === steps.length - 1;
        const label = (
          <span
            className={cn(
              "block pt-6 pr-4 text-sm",
              step.status === "current" && "font-bold text-foreground",
              step.status === "disabled" && "text-text-disabled",
              step.status === "error" && "text-danger",
              (step.status === "completed" || step.status === "enabled") && "text-primary",
            )}
          >
            {step.label}
            <span className="sr-only">, krok {statusText[step.status]}</span>
          </span>
        );
        return (
          <li
            key={step.label}
            className="relative w-32 shrink-0"
            aria-current={step.status === "current" ? "step" : undefined}
          >
            {!isLast && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-1 left-0 h-0.5 w-full",
                  step.status === "completed" ? "bg-primary" : "bg-text-disabled",
                )}
              />
            )}
            <span aria-hidden="true" className="absolute -top-1.5 -left-0.5">
              {step.status === "completed" ? (
                <span className="flex size-5.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <CheckIcon className="size-3.5" strokeWidth={3} />
                </span>
              ) : (
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full border-[2.5px] bg-background text-xs font-bold",
                    step.status === "disabled" && "border-text-disabled",
                    step.status === "error" && "border-danger text-danger",
                    (step.status === "current" || step.status === "enabled") && "border-primary",
                  )}
                >
                  {step.status === "current" && (
                    <span className="size-2.5 rounded-full bg-primary" />
                  )}
                  {step.status === "error" && "!"}
                </span>
              )}
            </span>
            {clickable ? (
              <button
                type="button"
                className="rounded-sm text-left hover:underline focus-visible:focus-ring"
                onClick={() => onSelect(i)}
              >
                {label}
              </button>
            ) : (
              label
            )}
          </li>
        );
      })}
    </ol>
  );
}
