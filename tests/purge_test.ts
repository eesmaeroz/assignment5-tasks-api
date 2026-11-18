// Meryem Esma Eröz, 2200005798
// Bonus 14: purgeOldDone deletes the tasks that were done more than 30 days ago.
import { assertEquals, assertNotEquals } from "@std/assert";
import { asc, eq } from "drizzle-orm";
import { tasks, users } from "../src/schema.ts";
import { purgeOldDone } from "../src/purge.ts";
import { TaskCache } from "../src/cache.ts";
import { createApp } from "../src/app.ts";
import { freshDb, login, makeTask, send } from "./helpers.ts";

const NOW = Date.UTC(2026, 10, 18, 3, 0, 0); // 18 Nov 2026, 03:00
const daysAgo = (days: number) => Math.floor(NOW / 1000) - days * 24 * 60 * 60;

/** One user with tasks inserted directly, each with its own done_at. */
async function dbWithTasks() {
  const database = await freshDb();
  const [user] = await database.db.insert(users)
    .values({ email: "esma@example.com", passwordHash: "x" }).returning();
  await database.db.insert(tasks).values([
    { userId: user.id, title: "done 40 days ago", status: "done", doneAt: daysAgo(40) },
    { userId: user.id, title: "done 31 days ago", status: "done", doneAt: daysAgo(31) },
    { userId: user.id, title: "done 29 days ago", status: "done", doneAt: daysAgo(29) },
    { userId: user.id, title: "done today", status: "done", doneAt: daysAgo(0) },
    // old but not done: stays, whatever its age
    { userId: user.id, title: "todo, old", status: "todo", createdAt: daysAgo(100) },
    // soft-deleted and done long ago: the purge removes it for real
    {
      userId: user.id,
      title: "deleted, done 50 days ago",
      status: "done",
      doneAt: daysAgo(50),
      deletedAt: daysAgo(45),
    },
  ]);
  return database;
}

const titles = async (database: Awaited<ReturnType<typeof dbWithTasks>>) =>
  (await database.db.select({ title: tasks.title }).from(tasks).orderBy(asc(tasks.id)))
    .map((t) => t.title);

Deno.test("purgeOldDone removes only done tasks older than 30 days", async () => {
  const database = await dbWithTasks();
  assertEquals(await purgeOldDone(database, 30, { now: NOW }), 3);
  assertEquals(await titles(database), ["done 29 days ago", "done today", "todo, old"]);
});

Deno.test("purgeOldDone is idempotent: the second run removes nothing", async () => {
  const database = await dbWithTasks();
  await purgeOldDone(database, 30, { now: NOW });
  const after = await titles(database);
  assertEquals(await purgeOldDone(database, 30, { now: NOW }), 0);
  assertEquals(await titles(database), after);
});

Deno.test("done_at is set when a task becomes done and cleared when it is not", async () => {
  const database = await freshDb();
  const app = createApp(database, { log: () => {} });
  const token = await login(app, "esma@example.com");

  const created = await makeTask(app, token, { title: "A5", status: "done" });
  assertNotEquals(created.doneAt, null);

  const reopened = await send(
    app,
    "PUT",
    `/api/tasks/${created.id}`,
    { title: "A5", status: "in-progress" },
    token,
  );
  assertEquals((await reopened.json()).doneAt, null);

  const todo = await makeTask(app, token, { title: "A6" });
  assertEquals(todo.doneAt, null);
});

Deno.test("saving a done task again keeps its first done_at", async () => {
  const database = await freshDb();
  const app = createApp(database, { log: () => {} });
  const token = await login(app, "esma@example.com");
  const task = await makeTask(app, token, { title: "A4", status: "done" });
  // pretend it was finished 40 days ago
  await database.db.update(tasks).set({ doneAt: daysAgo(40) }).where(
    eq(tasks.id, task.id),
  );

  const res = await send(
    app,
    "PUT",
    `/api/tasks/${task.id}`,
    { title: "A4 (renamed)", status: "done" },
    token,
  );
  assertEquals((await res.json()).doneAt, daysAgo(40));
});

Deno.test("purgeOldDone also removes the cached copy (Bonus 16)", async () => {
  const database = await freshDb();
  const kv = await Deno.openKv(":memory:");
  const cache = new TaskCache(kv);
  const app = createApp(database, { log: () => {}, cache });
  const token = await login(app, "esma@example.com");
  const task = await makeTask(app, token, { title: "old", status: "done" });
  await database.db.update(tasks).set({ doneAt: daysAgo(40) }).where(
    eq(tasks.id, task.id),
  );
  await send(app, "GET", `/api/tasks/${task.id}`, undefined, token); // cached

  assertEquals(await purgeOldDone(database, 30, { now: NOW, cache }), 1);
  const res = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  assertEquals(res.status, 404);
  kv.close();
});

Deno.test("purgeOldDone also deletes the image of a removed task (Bonus 12)", async () => {
  const database = await dbWithTasks();
  const dir = await Deno.makeTempDir();
  await Deno.writeFile(`${dir}/old.png`, new Uint8Array([1]));
  await Deno.writeFile(`${dir}/new.png`, new Uint8Array([2]));
  await database.db.update(tasks).set({ attachment: "old.png" })
    .where(eq(tasks.title, "done 40 days ago"));
  await database.db.update(tasks).set({ attachment: "new.png" })
    .where(eq(tasks.title, "done today"));

  await purgeOldDone(database, 30, { now: NOW, uploadDir: dir });
  const left: string[] = [];
  for await (const entry of Deno.readDir(dir)) left.push(entry.name);
  assertEquals(left, ["new.png"]);
});
