import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-card p-5 shadow-card", className)} {...props} />;
}
export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center rounded-sm border border-border bg-subtle px-2 py-0.5 text-xs font-medium text-foreground/80", className)} {...props} />;
}
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[1.6rem] font-semibold leading-tight tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
      <table
        className={cn(
          "w-full text-left text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted [&_thead]:bg-subtle [&_tbody_tr]:nx-t [&_tbody_tr:hover]:bg-primary/[0.03] [&_tr]:border-b [&_tr]:border-line last:[&_tr]:border-0",
          className,
        )}
        {...props}
      />
    </div>
  );
}
const ALERT = { error: "border-danger/30 bg-danger/[0.06] text-danger", success: "border-success/30 bg-success/[0.07] text-success" } as const;
export function Alert({ kind = "error", children }: { kind?: "error" | "success"; children: React.ReactNode }) {
  return (
    <p role={kind === "error" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-sm", ALERT[kind])}>
      {children}
    </p>
  );
}

/** Stato vuoto: icona, spiegazione breve e un'azione suggerita (nessun contenuto AI superfluo). */
export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon && <span className="mb-1 inline-flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>}
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Scheletro di caricamento: da usare solo durante caricamenti effettivi. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-foreground/[0.07]", className)} />;
}
