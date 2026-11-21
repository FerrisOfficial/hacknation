import { cn } from "cn";
import * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:aria-invalid:ring-destructive/40 min-h-28 rounded border-input bg-background px-3 py-2 text-base md:text-base focus-visible:border-b-3 focus-visible:border-b-primary focus-visible:rounded-b-none aria-invalid:border-b-3 aria-invalid:border-b-danger aria-invalid:rounded-b-none disabled:bg-muted disabled:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
