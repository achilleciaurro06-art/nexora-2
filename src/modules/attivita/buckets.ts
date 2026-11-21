export type BucketTask = { status: string; due_at: string | null };

export type TaskBuckets<T extends BucketTask> = { overdue: T[]; soon: T[]; later: T[]; done: T[] };

/** Scadute / imminenti (entro `soonDays`) / altre aperte (senza scadenza o più avanti) / chiuse. */
export function bucketTasks<T extends BucketTask>(tasks: T[], now: Date, soonDays = 7): TaskBuckets<T> {
  const limit = now.getTime() + soonDays * 86_400_000;
  const out: TaskBuckets<T> = { overdue: [], soon: [], later: [], done: [] };
  for (const t of tasks) {
    if (t.status === "done" || t.status === "cancelled") { out.done.push(t); continue; }
    const due = t.due_at ? new Date(t.due_at).getTime() : null;
    if (due !== null && due < now.getTime()) out.overdue.push(t);
    else if (due !== null && due <= limit) out.soon.push(t);
    else out.later.push(t);
  }
  const byDue = (a: T, b: T) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999");
  out.overdue.sort(byDue); out.soon.sort(byDue); out.later.sort(byDue);
  return out;
}
