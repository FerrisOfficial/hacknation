import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import * as React from "react";

const alertVariants = cva(
  // Komunikat Gov.pl: obramowanie 2px w kolorze typu + ikona 32px po lewej. Kolor nigdy nie jest jedynym nośnikiem informacji.
  "group/alert relative grid w-full gap-1 rounded border-2 bg-background px-4 py-3 text-left text-base text-foreground has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 *:[svg]:row-span-2 *:[svg:not([class*='size-'])]:size-8",
  {
    variants: {
      variant: {
        default: "border-info *:[svg]:text-info",
        info: "border-info *:[svg]:text-info",
        success: "border-success *:[svg]:text-success",
        warning: "border-warning *:[svg]:text-warning",
        destructive: "border-danger *:[svg]:text-danger",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "pt-1 font-semibold group-has-[>svg]/alert:col-start-2 [&_a]:text-text-link [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:text-primary-hover",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-base text-pretty text-foreground [&_a]:text-text-link [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:text-primary-hover [&_p:not(:last-child)]:mb-4",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="alert-action" className={cn("absolute top-2 right-2", className)} {...props} />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
