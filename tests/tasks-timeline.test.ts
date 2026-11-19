import { describe, expect, it } from "vitest";
import { bucketTasks } from "@/modules/attivita/buckets";
import { groupByDay, parseTimelineFilter, eventHref } from "@/modules/clienti/timeline";
import { taskSchema, dueAtFromDate } from "@/modules/attivita/schemas";

const now = new Date("2026-06-10T10:00:00Z");
const t = (status: string, due: string | null) => ({ status, due_at: due });

describe("bucketTasks", () => {
  it("separates overdue, soon (7 days), later and done", () => {
    const b = bucketTasks([
      t("todo", "2026-06-09T09:00:00Z"), t("in_progress", "2026-06-12T09:00:00Z"), t("todo", "2026-06-17T11:00:00Z"),
      t("todo", null), t("done", "2026-06-01T09:00:00Z"), t("cancelled", null),
    ], now);
    expect(b.overdue).toHaveLength(1);
    expect(b.soon).toHaveLength(1);
    expect(b.later).toHaveLength(2);
    expect(b.done).toHaveLength(2);
  });
  it("does not treat completed overdue tasks as overdue and sorts by due date", () => {
    const b = bucketTasks([t("done", "2026-05-01T00:00:00Z"), t("todo", "2026-06-05T00:00:00Z"), t("todo", "2026-06-01T00:00:00Z")], now);
    expect(b.overdue.map((x) => x.due_at)).toEqual(["2026-06-01T00:00:00Z", "2026-06-05T00:00:00Z"]);
    expect(b.done).toHaveLength(1);
  });
});

describe("timeline helpers", () => {
  it("falls back to 'all' on unknown filters", () => {
    expect(parseTimelineFilter("quote").key).toBe("quote");
    expect(parseTimelineFilter("x; drop table").key).toBe("all");
    expect(parseTimelineFilter(undefined).key).toBe("all");
  });
  it("groups events by day preserving order", () => {
    const g = groupByDay([
      { id: 3, entity: "quote", entity_id: "q", summary: "c", created_at: "2026-06-10T15:00:00Z", actor_id: null },
      { id: 2, entity: "task", entity_id: "t", summary: "b", created_at: "2026-06-10T09:00:00Z", actor_id: null },
      { id: 1, entity: "customer", entity_id: "c", summary: "a", created_at: "2026-06-01T09:00:00Z", actor_id: null },
    ]);
    expect(g).toHaveLength(2);
    expect(g[0]?.events.map((e) => e.id)).toEqual([3, 2]);
  });
  it("links events to the right pages", () => {
    const base = { summary: "", created_at: "", actor_id: null };
    expect(eventHref({ ...base, id: 1, entity: "quote", entity_id: "Q" }, "C")).toBe("/preventivi/Q");
    expect(eventHref({ ...base, id: 1, entity: "task", entity_id: "T" }, "C")).toBe("/attivita/T");
    expect(eventHref({ ...base, id: 1, entity: "note", entity_id: "N" }, "C")).toBe("/clienti/C");
    expect(eventHref({ ...base, id: 1, entity: "customer", entity_id: "C" }, "C")).toBeUndefined();
  });
});

describe("taskSchema", () => {
  it("normalises empty optional fields and rejects bad ids/dates", () => {
    const ok = taskSchema.parse({ title: " Chiamare ", dueDate: "", assigneeId: "", customerId: "", quoteId: "" });
    expect(ok.title).toBe("Chiamare");
    expect(ok.dueDate).toBeNull();
    expect(ok.assigneeId).toBeNull();
    expect(ok.status).toBe("todo");
    expect(taskSchema.safeParse({ title: "x", customerId: "not-a-uuid" }).success).toBe(false);
    expect(taskSchema.safeParse({ title: "x", dueDate: "domani" }).success).toBe(false);
    expect(taskSchema.safeParse({ title: "", }).success).toBe(false);
    expect(dueAtFromDate(null)).toBeNull();
  });
});
