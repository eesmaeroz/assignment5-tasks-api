// Meryem Esma Eröz, 2200005798
// Bonus 16: a cache for GET /api/tasks/:id in Deno KV.
import type { Task } from "./schema.ts";

/** What is stored under a key: the task and the moment (ms) it stops being fresh. */
type Entry = { task: Task; until: number };

/**
 * One cached task per key ["task", userId, taskId]. The user id is part of the key, so
 * a lookup by another user can never find this user's task, even with the same task id.
 */
export class TaskCache {
  /** Counted for the tests and the README run. */
  hits = 0;
  misses = 0;

  constructor(
    private kv: Deno.Kv,
    private ttlMs = 60_000,
    private now: () => number = Date.now,
  ) {}

  static key(userId: number, taskId: number): Deno.KvKey {
    return ["task", userId, taskId];
  }

  async get(userId: number, taskId: number): Promise<Task | null> {
    const entry = await this.kv.get<Entry>(TaskCache.key(userId, taskId));
    // expireIn alone is not enough: Deno KV removes expired keys later, in the
    // background, and until then kv.get still returns them (tried in a test run). So the
    // entry carries its own end time and is checked here too.
    if (entry.value && entry.value.until > this.now()) {
      this.hits++;
      return entry.value.task;
    }
    this.misses++;
    return null;
  }

  async set(task: Task): Promise<void> {
    const entry: Entry = { task, until: this.now() + this.ttlMs };
    await this.kv.set(TaskCache.key(task.userId, task.id), entry, {
      expireIn: this.ttlMs,
    });
  }

  /** Call after every change of the task (update, delete, restore, purge). */
  async delete(userId: number, taskId: number): Promise<void> {
    await this.kv.delete(TaskCache.key(userId, taskId));
  }
}
