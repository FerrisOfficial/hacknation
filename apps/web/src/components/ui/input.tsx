import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "cn";
import type * as React from "react";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:aria-invalid:ring-destructive/40 h-11 rounded border-input bg-background px-3 py-2 text-base md:text-base focus-visible:border-b-3 focus-visible:border-b-primary focus-visible:rounded-b-none aria-invalid:border-b-3 aria-invalid:border-b-danger aria-invalid:rounded-b-none disabled:bg-muted disabled:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
