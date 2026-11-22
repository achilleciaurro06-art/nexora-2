import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "nx-t w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-[inset_0_1px_0_rgba(16,24,40,0.02)] placeholder:text-muted/80 hover:border-primary/40 focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary/30 user-invalid:border-danger aria-[invalid=true]:border-danger disabled:border-border disabled:bg-subtle disabled:opacity-60";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, "h-10", className)} {...props} />;
}
export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "min-h-20 py-2.5", className)} {...props} />;
}
export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, "h-10", className)} {...props} />;
}
export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-foreground", className)} {...props} />;
}
