// Meryem Esma Eröz, 2200005798
// Bonus 2: soft delete, restore and a transaction.
import { assertEquals } from "@std/assert";
import { count, eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { createDb, migrate } from "../src/db.ts";
import { tasks, users } from "../src/schema.ts";
import { freshApp, login, makeTask, send } from "./helpers.ts";

const titles = (page: { items: { title: string }[] }) => page.items.map((t) => t.title);

Deno.test("register creates the user and a welcome task", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  const page = await (await send(app, "GET", "/api/tasks", undefined, token)).json();
  assertEquals(titles(page), ["Welcome! Add your first task"]);
  assertEquals(page.items[0].priority, "low");
});

Deno.test("a deleted task is not listed and not found, but the row is still there", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const database = createDb(`file:${file}`);
  await migrate(database);
  const app = createApp(database);
  const token = await login(app, "esma@example.com");
  const task = await makeTask(app, token, { title: "Read chapter 5" });

  const del = await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, token);
  assertEquals(del.status, 200);

  const page = await (await send(app, "GET", "/api/tasks", undefined, token)).json();
  assertEquals([titles(page), page.total], [["Welcome! Add your first task"], 1]);
  const get = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  const put = await send(app, "PUT", `/api/tasks/${task.id}`, { title: "x" }, token);
  const again = await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, token);
  assertEquals([get.status, put.status, again.status], [404, 404, 404]);

  // in the database the row still exists, with a deleted_at time
  const [row] = await database.db.select().from(tasks).where(eq(tasks.id, task.id));
  assertEquals(row.title, "Read chapter 5");
  assertEquals(typeof row.deletedAt, "number");
});

Deno.test("restore brings a deleted task back, unchanged", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  const task = await makeTask(app, token, {
    title: "OOP lab",
    priority: "high",
    dueDate: "2026-11-21",
  });
  await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, token);

  const res = await send(app, "POST", `/api/tasks/${task.id}/restore`, undefined, token);
  assertEquals(res.status, 200);
  const restored = await res.json();
  assertEquals(
    [restored.title, restored.priority, restored.dueDate, restored.deletedAt],
    ["OOP lab", "high", "2026-11-21", null],
  );
  const get = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  assertEquals(get.status, 200);
});

Deno.test("restore is 404 for a task that is not deleted, or not mine", async () => {
  const app = await freshApp();
  const esma = await login(app, "esma@example.com");
  const mery = await login(app, "mery@example.com");
  const task = await makeTask(app, esma, { title: "Mine" });

  const notDeleted = await send(
    app,
    "POST",
    `/api/tasks/${task.id}/restore`,
    undefined,
    esma,
  );
  await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, esma);
  const notMine = await send(
    app,
    "POST",
    `/api/tasks/${task.id}/restore`,
    undefined,
    mery,
  );
  const missing = await send(app, "POST", "/api/tasks/9999/restore", undefined, esma);
  assertEquals([notDeleted.status, notMine.status, missing.status], [404, 404, 404]);
  assertEquals((await notMine.json()).error, "deleted task not found");
});

Deno.test("when the welcome task fails, the user is rolled back too", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const database = createDb(`file:${file}`);
  await migrate(database);
  // A welcome task that breaks a CHECK constraint, so the second insert throws.
  const app = createApp(database, {
    welcomeTask: (userId) => ({ userId, title: "Welcome!", priority: "urgent" as "low" }),
  });

  const res = await send(app, "POST", "/auth/register", {
    email: "esma@example.com",
    password: "kediler123",
  });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "internal error", issues: [] });

  const [{ n }] = await database.db.select({ n: count() }).from(users);
  assertEquals(n, 0); // no user left behind without a welcome task

  // and because nothing was left behind, the same email can register later
  const fixed = createApp(database);
  const retry = await send(fixed, "POST", "/auth/register", {
    email: "esma@example.com",
    password: "kediler123",
  });
  assertEquals(retry.status, 201);
});
