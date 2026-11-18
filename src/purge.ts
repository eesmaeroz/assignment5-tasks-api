// Meryem Esma Eröz, 2200005798
// Bonus 14: the work of the nightly job, as a plain function that a test can call.
import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { Db } from "./db.ts";
import { tasks } from "./schema.ts";
import type { TaskCache } from "./cache.ts";

const DAY = 24 * 60 * 60; // seconds

export type PurgeOptions = {
  /** The current time in ms; a test passes its own. */
  now?: number;
  /** Bonus 16: remove the cached copies too, or GET could still show a purged task. */
  cache?: TaskCache;
};

/**
 * Delete the tasks that were done more than `days` days ago and return how many.
 * This is a real DELETE, also for soft-deleted rows: the point is to free the space.
 * Running it twice changes nothing the second time, because the rows are gone.
 */
export async function purgeOldDone(
  { db }: Db,
  days: number,
  options: PurgeOptions = {},
): Promise<number> {
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  const cutoff = nowSeconds - days * DAY;
  const removed = await db.delete(tasks)
    .where(and(
      eq(tasks.status, "done"),
      isNotNull(tasks.doneAt),
      lt(tasks.doneAt, cutoff),
    ))
    .returning({ id: tasks.id, userId: tasks.userId });
  for (const row of removed) await options.cache?.delete(row.userId, row.id);
  return removed.length;
}
