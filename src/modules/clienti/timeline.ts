import { fmtLongDay } from "@/lib/datetime";

export const TIMELINE_FILTERS = [
  { key: "all", label: "Tutto", entities: null },
  { key: "quote", label: "Preventivi", entities: ["quote"] },
  { key: "task", label: "Attività", entities: ["task"] },
  { key: "interazioni", label: "Appuntamenti, chiamate, follow-up", entities: ["appointment", "call", "follow_up"] },
  { key: "document", label: "Documenti", entities: ["document"] },
  { key: "contact", label: "Referenti", entities: ["contact"] },
  { key: "note", label: "Note", entities: ["note"] },
  { key: "customer", label: "Cliente", entities: ["customer"] },
] as const;

export type TimelineFilterKey = (typeof TIMELINE_FILTERS)[number]["key"];

export function parseTimelineFilter(v: string | undefined): (typeof TIMELINE_FILTERS)[number] {
  return TIMELINE_FILTERS.find((f) => f.key === v) ?? TIMELINE_FILTERS[0];
}

export type TimelineEvent = { id: number; entity: string; entity_id: string | null; summary: string; created_at: string; actor_id: string | null };

/** Raggruppa gli eventi per giorno (data locale it-IT), dal più recente. */
export function groupByDay(events: TimelineEvent[]): { day: string; events: TimelineEvent[] }[] {
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const day = fmtLongDay(e.created_at);
    const list = groups.get(day) ?? [];
    list.push(e);
    groups.set(day, list);
  }
  return [...groups.entries()].map(([day, evs]) => ({ day, events: evs }));
}

export function eventHref(e: TimelineEvent, customerId: string): string | undefined {
  if (e.entity === "quote" && e.entity_id) return `/preventivi/${e.entity_id}`;
  if (e.entity === "task" && e.entity_id) return `/attivita/${e.entity_id}`;
  if (e.entity === "appointment" && e.entity_id) return `/appuntamenti/${e.entity_id}`;
  if (e.entity === "follow_up" && e.entity_id) return `/followup/${e.entity_id}`;
  if (e.entity === "call") return `/chiamate?cliente=${customerId}`;
  if (e.entity === "document") return `/documenti`;
  return e.entity === "customer" ? undefined : `/clienti/${customerId}`;
}
