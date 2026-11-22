import { describe, expect, it } from "vitest";
import { addDays, dayRangeUtc, fmtDay, fmtTime, todayIn, tzOffsetMs, utcToZonedParts, zonedToUtcIso } from "@/lib/datetime";
import { FOLLOW_UP_STATUSES, allowedTransitions, isOverdue, needsActionNow } from "@/modules/followup/states";
import { agendaCounts, applyFilters, bucketAgenda, needsAction, viewOf, type AgendaItem } from "@/modules/agenda/agenda";
import { CAL_VIEWS, addMonths, isDateStr, monthGrid, parseCalView, shiftDate, startOfWeek, titleFor, visibleRange, weekDays } from "@/modules/appuntamenti/calendar";
import { parseReminderOffset } from "@/modules/agenda/types";

describe("fusi orari (Europe/Rome)", () => {
  it("ora legale e ora solare", () => {
    expect(zonedToUtcIso("2026-01-15T10:00")).toBe("2026-01-15T09:00:00.000Z"); // CET = UTC+1
    expect(zonedToUtcIso("2026-07-15T10:00")).toBe("2026-07-15T08:00:00.000Z"); // CEST = UTC+2
  });
  it("andata e ritorno senza spostamenti di data o ora, anche vicino a mezzanotte", () => {
    for (const local of ["2026-07-15T00:00", "2026-07-15T23:59", "2026-01-01T00:30", "2026-12-31T23:30", "2026-03-28T23:45", "2026-10-24T23:45"]) {
      const iso = zonedToUtcIso(local)!;
      const p = utcToZonedParts(iso);
      expect(`${p.date}T${p.time}`).toBe(local);
    }
  });
  it("il server in UTC non cambia il risultato: 00:30 di Roma è ancora il giorno precedente in UTC ma la data locale resta quella", () => {
    const iso = zonedToUtcIso("2026-07-15T00:30")!;
    expect(iso).toBe("2026-07-14T22:30:00.000Z");
    expect(utcToZonedParts(iso).date).toBe("2026-07-15");
    expect(todayIn(new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
  });
  it("giorni del cambio ora: 23 e 25 ore, orario inesistente scorre avanti", () => {
    const spring = dayRangeUtc("2026-03-29"); const autumn = dayRangeUtc("2026-10-25");
    expect((Date.parse(spring.to) - Date.parse(spring.from)) / 3_600_000).toBe(23);
    expect((Date.parse(autumn.to) - Date.parse(autumn.from)) / 3_600_000).toBe(25);
    expect(utcToZonedParts(zonedToUtcIso("2026-03-29T02:30")!).time).toBe("03:30"); // 02:30 non esiste
    expect(zonedToUtcIso("2026-10-25T02:30")).not.toBeNull(); // ambiguo ma valido
    expect(tzOffsetMs(Date.parse("2026-07-01T00:00:00Z"))).toBe(2 * 3_600_000);
  });
  it("rifiuta formati e date non valide", () => {
    for (const bad of ["", "15/07/2026", "2026-02-30T10:00", "2026-07-15T25:00", "2026-07-15T10:61", "domani"]) expect(zonedToUtcIso(bad)).toBeNull();
    expect(zonedToUtcIso("2026-07-15")).toBe("2026-07-14T22:00:00.000Z"); // solo data = mezzanotte locale
  });
  it("formattazione sempre nel fuso dell'azienda e date pure senza spostamenti", () => {
    expect(fmtTime("2026-07-15T08:00:00Z")).toBe("10:00");
    expect(fmtDay("2026-07-15")).toBe("15/07/2026");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("follow-up: sei stati e transizioni", () => {
  it("esattamente sei stati, nell'ordine previsto", () => {
    expect(FOLLOW_UP_STATUSES.map((s) => s.label)).toEqual(["Da fare", "Programmato", "In corso", "In attesa", "Completato", "Annullato"]);
  });
  it("gli aperti si muovono liberamente, i chiusi solo verso Da fare", () => {
    expect(allowedTransitions("todo")).toEqual(["scheduled", "in_progress", "waiting", "done", "cancelled"]);
    expect(allowedTransitions("waiting")).not.toContain("waiting");
    expect(allowedTransitions("done")).toEqual(["todo"]);
    expect(allowedTransitions("cancelled")).toEqual(["todo"]);
  });
  it("in ritardo solo se aperto e con data passata", () => {
    expect(isOverdue("todo", "2026-05-01", "2026-05-02")).toBe(true);
    expect(isOverdue("waiting", "2026-05-01", "2026-05-02")).toBe(true);
    expect(isOverdue("done", "2026-05-01", "2026-05-02")).toBe(false);
    expect(isOverdue("cancelled", "2026-05-01", "2026-05-02")).toBe(false);
    expect(isOverdue("todo", "2026-05-02", "2026-05-02")).toBe(false);
  });
  it("richiede azione ora: da fare/in corso oggi o in ritardo; programmato/in attesa solo se scaduti", () => {
    expect(needsActionNow("todo", "2026-05-02", "2026-05-02")).toBe(true);
    expect(needsActionNow("in_progress", "2026-05-02", "2026-05-02")).toBe(true);
    expect(needsActionNow("scheduled", "2026-05-02", "2026-05-02")).toBe(false);
    expect(needsActionNow("waiting", "2026-05-02", "2026-05-02")).toBe(false);
    expect(needsActionNow("waiting", "2026-05-01", "2026-05-02")).toBe(true);
    expect(needsActionNow("todo", "2026-05-09", "2026-05-02")).toBe(false);
    expect(needsActionNow("done", "2026-05-01", "2026-05-02")).toBe(false);
  });
});

const NOW = new Date("2026-05-10T10:00:00Z"); // 12:00 a Roma
const item = (o: Partial<AgendaItem>): AgendaItem => ({
  kind: "task", id: crypto.randomUUID(), title: "t", when_at: null, when_date: null, has_time: false, status: "todo", is_open: true, is_done: false, priority: "normal",
  assignee_id: null, customer_id: null, customer_name: null, customer_archived: false, type_key: "generic", completed_at: null, href: "/x", ...o,
});
describe("centro promemoria: viste, filtri e conteggi", () => {
  const items = [
    item({ title: "scaduta", when_date: "2026-05-08", when_at: "2026-05-07T22:00:00Z" }),
    item({ title: "oggi urgente", when_date: "2026-05-10", when_at: "2026-05-09T22:00:00Z", priority: "urgent", assignee_id: "u1" }),
    item({ title: "oggi", when_date: "2026-05-10", when_at: "2026-05-09T22:00:00Z" }),
    item({ title: "domani", when_date: "2026-05-11", when_at: "2026-05-10T22:00:00Z", kind: "appointment", type_key: "appointment" }),
    item({ title: "senza data" }),
    item({ title: "lontana", when_date: "2026-09-01", when_at: "2026-08-31T22:00:00Z" }),
    item({ title: "fatta", is_open: false, is_done: true, status: "done", when_date: "2026-05-09", completed_at: "2026-05-09T15:00:00Z" }),
    item({ title: "annullata", is_open: false, status: "cancelled" }),
    item({ title: "fu programmato oggi", kind: "follow_up", status: "scheduled", when_date: "2026-05-10", type_key: "follow_up" }),
    item({ title: "tel", type_key: "call", when_date: "2026-05-12", when_at: "2026-05-11T22:00:00Z" }),
  ];
  it("ogni elemento sta in una sola vista", () => {
    const b = bucketAgenda(items, NOW);
    expect(b.overdue.map((i) => i.title)).toEqual(["scaduta"]);
    expect(b.today.map((i) => i.title)).toEqual(["oggi urgente", "oggi", "fu programmato oggi"]); // urgente per primo
    expect(b.upcoming.map((i) => i.title)).toEqual(["domani", "tel", "senza data"]);
    expect(b.done.map((i) => i.title)).toEqual(["fatta"]);
    const all = [...b.overdue, ...b.today, ...b.upcoming, ...b.done];
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
  });
  it("gli elementi oltre l'orizzonte e quelli annullati non compaiono; la 'lontana' non è lavoro prossimo", () => {
    const all = Object.values(bucketAgenda(items, NOW)).flat().map((i) => i.title);
    expect(all).not.toContain("lontana"); expect(all).not.toContain("annullata");
  });
  it("'oggi' dipende dal fuso dell'azienda, non da UTC", () => {
    const late = new Date("2026-05-10T22:30:00Z"); // 00:30 dell'11 a Roma
    expect(viewOf(items[1]!, late)).toBe("overdue");
    expect(viewOf(items[3]!, late)).toBe("today");
  });
  it("conteggi coerenti con le viste, urgenti e azioni immediate", () => {
    const c = agendaCounts(items, NOW);
    expect(c).toMatchObject({ overdue: 1, today: 3, upcoming: 3, done: 1, urgent: 1 });
    expect(c.needsAction).toBe(3); // scaduta + 2 di oggi; il follow-up programmato oggi non richiede azione
    expect(needsAction(items[8]!, NOW)).toBe(false);
  });
  it("filtri per responsabile, tipologia e priorità", () => {
    expect(applyFilters(items, { assignee: "u1" }).map((i) => i.title)).toEqual(["oggi urgente"]);
    expect(applyFilters(items, { assignee: "none" }).length).toBe(items.length - 1);
    expect(applyFilters(items, { type: "appointment" }).map((i) => i.title)).toEqual(["domani"]);
    expect(applyFilters(items, { type: "call" }).map((i) => i.title)).toEqual(["tel"]);
    expect(applyFilters(items, { type: "follow_up" }).length).toBe(1);
    expect(applyFilters(items, { priority: "urgent" }).length).toBe(1);
    expect(applyFilters(items, {}).length).toBe(items.length);
  });
  it("senza dati: tutto a zero, nessun errore", () => {
    expect(agendaCounts([], NOW)).toEqual({ today: 0, overdue: 0, upcoming: 0, done: 0, urgent: 0, needsAction: 0 });
    expect(Object.values(bucketAgenda([], NOW)).every((l) => l.length === 0)).toBe(true);
  });
});

describe("calendario", () => {
  it("settimane da lunedì a domenica, mese completo", () => {
    expect(startOfWeek("2026-05-10")).toBe("2026-05-04"); // domenica -> lunedì precedente
    expect(weekDays("2026-05-06")[0]).toBe("2026-05-04");
    expect(weekDays("2026-05-06")[6]).toBe("2026-05-10");
    const g = monthGrid("2026-02-14"); // febbraio 2026 inizia di domenica
    expect(g[0]![0]).toBe("2026-01-26"); expect(g.length).toBe(5);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.flat()).toContain("2026-02-28");
  });
  it("navigazione tra mesi, settimane e giorni, senza saltare a fine mese", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(shiftDate("mese", "2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftDate("settimana", "2026-05-10", 1)).toBe("2026-05-17");
    expect(shiftDate("giorno", "2026-12-31", 1)).toBe("2027-01-01");
  });
  it("intervallo visibile e titoli", () => {
    expect(visibleRange("giorno", "2026-05-10")).toEqual({ from: "2026-05-10", to: "2026-05-11" });
    expect(visibleRange("settimana", "2026-05-10")).toEqual({ from: "2026-05-04", to: "2026-05-11" });
    expect(visibleRange("mese", "2026-05-10").from).toBe("2026-04-27");
    expect(titleFor("mese", "2026-05-10")).toBe("maggio 2026");
    expect(titleFor("settimana", "2026-05-10")).toBe("4 maggio – 10 maggio 2026");
    expect(titleFor("giorno", "2026-05-10")).toBe("10 maggio 2026");
  });
  it("parametri non validi tornano ai valori predefiniti", () => {
    // la vista predefinita è la settimana (scelta di progetto); le altre viste restano raggiungibili
    expect(parseCalView("boh")).toBe("settimana"); expect(parseCalView(undefined)).toBe("settimana"); expect(parseCalView("")).toBe("settimana");
    expect(parseCalView("mese")).toBe("mese"); expect(parseCalView("settimana")).toBe("settimana"); expect(parseCalView("giorno")).toBe("giorno");
    expect(parseCalView("elenco")).toBe("settimana"); // «elenco» non è una vista del calendario (è gestita dalla pagina)
    expect(CAL_VIEWS.map((v) => v.key)).toEqual(["mese", "settimana", "giorno"]);
    expect(isDateStr("2026-02-30")).toBe(false); expect(isDateStr("2026-05-10")).toBe(true); expect(isDateStr("10/05/2026")).toBe(false); expect(isDateStr(undefined)).toBe(false);
  });
});

describe("promemoria: scelta del momento", () => {
  it("valori ammessi e non ammessi", () => {
    expect(parseReminderOffset("")).toBeNull(); expect(parseReminderOffset(undefined)).toBeNull();
    expect(parseReminderOffset("0")).toBe(0); expect(parseReminderOffset("60")).toBe(60); expect(parseReminderOffset("1440")).toBe(1440);
    expect(parseReminderOffset("7")).toBe("invalid"); expect(parseReminderOffset("-5")).toBe("invalid");
  });
});

import { appointmentSchema } from "@/modules/appuntamenti/schemas";
import { callSchema } from "@/modules/chiamate/schemas";
import { followUpEditSchema, followUpSchema, rescheduleSchema, statusChangeSchema } from "@/modules/followup/schemas";
import { taskSchema } from "@/modules/attivita/schemas";

describe("validazione appuntamenti", () => {
  const ok = { title: "Visita", date: "2026-07-15", startTime: "10:00", endTime: "11:30", reminder: "60" };
  it("converte in UTC dal fuso dell'azienda e il promemoria in minuti", () => {
    const r = appointmentSchema.parse(ok);
    expect(r.startsAt).toBe("2026-07-15T08:00:00.000Z");
    expect(r.endsAt).toBe("2026-07-15T09:30:00.000Z");
    expect(r.reminder).toBe(60);
    expect(r.customerId).toBeNull();
  });
  it("rifiuta fine non successiva all'inizio, orari e date non validi, promemoria sconosciuti", () => {
    for (const bad of [{ endTime: "10:00" }, { endTime: "09:00" }, { startTime: "25:00" }, { date: "15/07/2026" }, { date: "2026-02-30" }, { reminder: "7" }, { title: " " }, { customerId: "x" }])
      expect(appointmentSchema.safeParse({ ...ok, ...bad }).success).toBe(false);
  });
});

describe("validazione chiamate", () => {
  const ok = { customerId: crypto.randomUUID(), direction: "outbound", date: "2026-01-10", time: "09:15", outcome: "callback", durationMinutes: "5,5" };
  it("accetta una chiamata valida e calcola istante e durata", () => {
    const r = callSchema.parse(ok);
    expect(r.calledAt).toBe("2026-01-10T08:15:00.000Z");
    expect(r.durationSeconds).toBe(330);
    expect(r.nextOn).toBeNull();
  });
  it.each([["senza cliente", { customerId: "" }], ["esito sconosciuto", { outcome: "boh" }], ["direzione mancante", { direction: "" }], ["durata negativa", { durationMinutes: "-1" }], ["durata assurda", { durationMinutes: "9999" }],
    ["nel futuro", { date: "2999-01-01" }], ["data del prossimo contatto non valida", { nextOn: "domani" }]])("rifiuta: %s", (_n, patch) => expect(callSchema.safeParse({ ...ok, ...patch }).success).toBe(false));
  it("accetta tutti gli esiti previsti", () => {
    for (const outcome of ["answered", "no_answer", "busy", "callback", "interested", "not_interested", "other"]) expect(callSchema.safeParse({ ...ok, outcome }).success).toBe(true);
  });
});

describe("validazione follow-up", () => {
  const ok = { customerId: crypto.randomUUID(), title: "Richiamare", dueOn: "2026-05-20" };
  it("stato iniziale ammesso solo Da fare o Programmato", () => {
    expect(followUpSchema.parse(ok).status).toBe("todo");
    expect(followUpSchema.parse({ ...ok, status: "scheduled" }).status).toBe("scheduled");
    for (const status of ["done", "cancelled", "waiting", "in_progress", "boh"]) expect(followUpSchema.safeParse({ ...ok, status }).success).toBe(false);
  });
  it("data, cliente e titolo obbligatori e validi", () => {
    for (const bad of [{ dueOn: "" }, { dueOn: "2026-02-31" }, { customerId: "" }, { title: "" }, { priority: "boh" }]) expect(followUpSchema.safeParse({ ...ok, ...bad }).success).toBe(false);
  });
  it("la modifica non cambia cliente, data né stato (si usano riprogrammazione e cambio stato)", () => {
    const r = followUpEditSchema.parse({ ...ok, notes: "n" }) as Record<string, unknown>;
    expect("customerId" in r || "dueOn" in r || "status" in r).toBe(false);
  });
  it("cambio di stato: tutti e sei gli stati, nota limitata; riprogrammazione con data valida", () => {
    for (const s of ["todo", "scheduled", "in_progress", "waiting", "done", "cancelled"]) expect(statusChangeSchema.safeParse({ status: s }).success).toBe(true);
    expect(statusChangeSchema.safeParse({ status: "sospeso" }).success).toBe(false);
    expect(statusChangeSchema.safeParse({ status: "done", note: "x".repeat(501) }).success).toBe(false);
    expect(rescheduleSchema.safeParse({ dueOn: "2026-06-01", note: "ferie" }).success).toBe(true);
    expect(rescheduleSchema.safeParse({ dueOn: "01/06/2026" }).success).toBe(false);
  });
});

describe("validazione attività estese", () => {
  it("ora, durata e promemoria", () => {
    const r = taskSchema.parse({ title: "t", dueDate: "2026-07-15", dueTime: "14:30", durationMinutes: "45", reminder: "1440" });
    expect(r.dueTime).toBe("14:30"); expect(r.durationMinutes).toBe(45); expect(r.reminder).toBe(1440);
    for (const bad of [{ dueTime: "14:30" }, { dueDate: "2026-07-15", dueTime: "25:00" }, { durationMinutes: "0" }, { durationMinutes: "1441" }, { durationMinutes: "x" }, { reminder: "5" }, { contactId: "x" }, { typeId: "x" }])
      expect(taskSchema.safeParse({ title: "t", ...bad }).success).toBe(false);
  });
});
