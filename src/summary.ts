// Meryem Esma Eröz, 2200005798
// Bonus 3: how many tasks a user has per status, written twice.
import { and, count, eq, isNull } from "drizzle-orm";
import type { Db } from "./db.ts";
import { type Task, tasks } from "./schema.ts";

export type Summary = Record<Task["status"], number> & { total: number };

/** Every status is in the answer, with 0 when the user has none of them. */
const empty = (): Summary => ({ "todo": 0, "in-progress": 0, "done": 0, total: 0 });

const mine = (userId: number) => and(eq(tasks.userId, userId), isNull(tasks.deletedAt));

/**
 * The naive version (N+1): one query for the ids of my tasks, then one more query PER TASK
 * to read its status. 10 tasks = 11 queries, 1000 tasks = 1001 queries.
 */
export async function summaryNaive({ db }: Db, userId: number): Promise<Summary> {
  const result = empty();
  const ids = await db.select({ id: tasks.id }).from(tasks).where(mine(userId));
  for (const { id } of ids) {
    const [row] = await db.select({ status: tasks.status }).from(tasks)
      .where(eq(tasks.id, id));
    if (row) {
      result[row.status]++;
      result.total++;
    }
  }
  return result;
}

/** The good version: ONE query, the database counts with GROUP BY. */
export async function summaryGrouped({ db }: Db, userId: number): Promise<Summary> {
  const rows = await db
    .select({ status: tasks.status, n: count() })
    .from(tasks)
    .where(mine(userId))
    .groupBy(tasks.status);
  const result = empty();
  for (const { status, n } of rows) {
    result[status] = n;
    result.total += n;
  }
  return result;
}
