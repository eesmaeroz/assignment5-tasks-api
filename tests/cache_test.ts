// Meryem Esma Eröz, 2200005798
// Bonus 16: GET /api/tasks/:id is cached in Deno KV for 60 seconds.
import { assertEquals } from "@std/assert";
import type { Logger } from "drizzle-orm/logger";
import { createApp } from "../src/app.ts";
import { TaskCache } from "../src/cache.ts";
import { freshDb, login, makeTask, send } from "./helpers.ts";

/** Counts the SELECTs on the tasks table, so a test can see when the database was read. */
class TaskReads implements Logger {
  count = 0;
  logQuery(query: string): void {
    if (query.startsWith("select") && query.includes('from "tasks"')) this.count++;
  }
}

/** An app with a cache in an in-memory KV and a clock the test can move. */
async function cachedApp() {
  const reads = new TaskReads();
  const kv = await Deno.openKv(":memory:");
  const clock = { now: 1_000_000 };
  const cache = new TaskCache(kv, 60_000, () => clock.now);
  const app = createApp(await freshDb(reads), { log: () => {}, cache });
  return { app, kv, cache, reads, clock };
}

Deno.test("cache hit: the second GET does not read the database", async () => {
  const { app, kv, cache, reads } = await cachedApp();
  const token = await login(app, "esma@example.com");
  const task = await makeTask(app, token, { title: "Read unit 7" });

  reads.count = 0;
  const first = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  assertEquals([first.status, reads.count, cache.misses, cache.hits], [200, 1, 1, 0]);
  assertEquals(first.headers.get("x-cache"), "miss");

  const second = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  assertEquals([second.status, reads.count, cache.misses, cache.hits], [200, 1, 1, 1]);
  assertEquals(second.headers.get("x-cache"), "hit");
  assertEquals(await second.json(), await first.json());
  kv.close();
});

Deno.test("cache invalidation: a changed or deleted task is never served stale", async () => {
  const { app, kv, reads } = await cachedApp();
  const token = await login(app, "esma@example.com");
  const task = await makeTask(app, token, { title: "old title" });
  await send(app, "GET", `/api/tasks/${task.id}`, undefined, token); // now cached

  await send(app, "PUT", `/api/tasks/${task.id}`, { title: "new title" }, token);
  reads.count = 0;
  const afterPut = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  assertEquals((await afterPut.json()).title, "new title");
  assertEquals(reads.count, 1); // the PUT removed the entry, so this GET went to the db

  await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, token);
  const afterDelete = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  assertEquals(afterDelete.status, 404);
  kv.close();
});

Deno.test("cache key includes the user: another user never gets the cached task", async () => {
  const { app, kv } = await cachedApp();
  const esma = await login(app, "esma@example.com");
  const mery = await login(app, "mery@example.com");
  const task = await makeTask(app, esma, { title: "only mine" });
  await send(app, "GET", `/api/tasks/${task.id}`, undefined, esma); // cached for Esma

  const other = await send(app, "GET", `/api/tasks/${task.id}`, undefined, mery);
  assertEquals(other.status, 404);
  // the entry is stored under Esma's id only
  assertEquals((await kv.get(TaskCache.key(task.userId, task.id))).value !== null, true);
  const meryId = task.userId + 1;
  assertEquals((await kv.get(TaskCache.key(meryId, task.id))).value, null);
  kv.close();
});

Deno.test("cache entry is fresh for 60 seconds, then the database is read again", async () => {
  const { app, kv, reads, clock } = await cachedApp();
  const token = await login(app, "esma@example.com");
  const task = await makeTask(app, token, { title: "Read unit 7" });
  await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);

  reads.count = 0;
  clock.now += 59_000;
  await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  assertEquals(reads.count, 0); // 59 s: still a hit

  clock.now += 2_000;
  await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  assertEquals(reads.count, 1); // 61 s: too old, loaded again
  kv.close();
});
