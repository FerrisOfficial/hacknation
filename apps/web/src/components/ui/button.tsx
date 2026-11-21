import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/*
 * Przycisk Gov.pl (kit w Figmie: strona „Button”).
 * default     = Primary: akcja główna (Zapisz, Wyślij)
 * secondary   = Secondary: akcja alternatywna (Dowiedz się więcej)
 * outline     = alias Secondary (zgodność z domyślnymi komponentami shadcn)
 * ghost       = Tertiary: akcja mniej ważna lub negatywna (Anuluj)
 * destructive = Red primary: akcja nieodwracalna (Usuń)
 * destructive-secondary = Red secondary: alternatywa przy akcji nieodwracalnej
 * link        = wygląd odnośnika (ale to nadal akcja; nawigacja = <a>/<Link>)
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded border-2 border-transparent text-base font-bold whitespace-nowrap uppercase transition-colors outline-none select-none focus-visible:focus-ring disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:border-primary-hover hover:bg-primary-hover disabled:border-disabled disabled:bg-disabled",
        secondary:
          "border-primary bg-background text-primary hover:border-primary-hover hover:text-primary-hover disabled:border-disabled disabled:bg-muted disabled:text-disabled",
        outline:
          "border-primary bg-background text-primary hover:border-primary-hover hover:text-primary-hover disabled:border-disabled disabled:bg-muted disabled:text-disabled",
        ghost:
          "bg-transparent text-primary hover:text-primary-hover hover:underline disabled:text-disabled",
        destructive:
          "border-danger-strong bg-danger-strong text-primary-foreground hover:border-danger hover:bg-danger disabled:border-disabled disabled:bg-disabled",
        "destructive-secondary":
          "border-danger-strong bg-transparent text-danger-strong hover:border-danger hover:text-danger disabled:border-disabled disabled:bg-muted disabled:text-disabled",
        link: "h-auto border-0 px-0 font-normal normal-case text-text-link underline underline-offset-2 hover:text-primary-hover",
      },
      size: {
        default: "h-11 min-w-11 px-[30px]",
        sm: "h-9 min-w-9 px-5 text-sm",
        lg: "h-12 min-w-12 px-8",
        icon: "size-11",
        "icon-sm": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
