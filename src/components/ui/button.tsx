import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "nx-t inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-px",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-card hover:bg-primary-hover",
        outline: "border border-border bg-card text-foreground shadow-card hover:border-primary/40 hover:bg-subtle",
        ghost: "text-foreground hover:bg-foreground/[0.06]",
        danger: "bg-danger text-white shadow-card hover:opacity-90",
        dark: "bg-carbon text-white hover:bg-carbon-2",
        /** assistente AI: accento blu elettrico, riconoscibile ma non invadente */
        ai: "border border-primary/30 bg-primary/[0.07] text-primary hover:border-primary/60 hover:bg-primary/[0.13]",
      },
      size: { default: "h-10 px-4", sm: "h-8 px-3 text-xs", lg: "h-11 px-6 text-[0.95rem]" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
export { buttonVariants };
