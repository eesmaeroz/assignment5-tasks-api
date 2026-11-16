// Meryem Esma Eröz, 2200005798
import { assertEquals } from "@std/assert";
import { freshApp, login, makeTask, send } from "./helpers.ts";

Deno.test("/api without a token is 401 in the error shape", async () => {
  const app = await freshApp();
  const res = await send(app, "GET", "/api/tasks");
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "unauthorized", issues: [] });
});

Deno.test("a made-up token is 401 too", async () => {
  const app = await freshApp();
  const res = await send(app, "GET", "/api/tasks", undefined, "not-a-real-token");
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, "unauthorized");
});

Deno.test("create a task: 201 with the defaults filled in", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  const res = await send(app, "POST", "/api/tasks", { title: "Read chapter 4" }, token);
  assertEquals(res.status, 201);
  const task = await res.json();
  assertEquals(task.title, "Read chapter 4");
  assertEquals(task.status, "todo");
  assertEquals(task.priority, "medium");
  assertEquals(task.dueDate, null);
  assertEquals(typeof task.createdAt, "number");
});

Deno.test("list shows only my own tasks", async () => {
  const app = await freshApp();
  const esma = await login(app, "esma@example.com");
  const mery = await login(app, "mery@example.com");
  await makeTask(app, esma, { title: "Calculus homework" });
  await makeTask(app, mery, { title: "Mery's task" });
  const res = await send(app, "GET", "/api/tasks", undefined, esma);
  assertEquals(res.status, 200);
  const page = await res.json();
  assertEquals(page.total, 1);
  assertEquals(page.items.map((t: { title: string }) => t.title), ["Calculus homework"]);
});

Deno.test("another user's task is 404 for read, update and delete", async () => {
  const app = await freshApp();
  const esma = await login(app, "esma@example.com");
  const mery = await login(app, "mery@example.com");
  const task = await makeTask(app, esma, { title: "Only mine" });

  const read = await send(app, "GET", `/api/tasks/${task.id}`, undefined, mery);
  const update = await send(
    app,
    "PUT",
    `/api/tasks/${task.id}`,
    { title: "hacked" },
    mery,
  );
  const remove = await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, mery);
  assertEquals([read.status, update.status, remove.status], [404, 404, 404]);

  // and it is still there, unchanged, for the owner
  const mine = await send(app, "GET", `/api/tasks/${task.id}`, undefined, esma);
  assertEquals((await mine.json()).title, "Only mine");
});

Deno.test("an invalid status is 400 with the path of the problem", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  const res = await send(app, "POST", "/api/tasks", {
    title: "x",
    status: "finished",
  }, token);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "validation failed");
  assertEquals(body.issues[0].path, ["status"]);
});

Deno.test("a title of 101 characters and an impossible due date are 400", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  const long = await send(app, "POST", "/api/tasks", { title: "a".repeat(101) }, token);
  const date = await send(app, "POST", "/api/tasks", {
    title: "ok",
    dueDate: "2026-02-30",
  }, token);
  assertEquals([long.status, date.status], [400, 400]);
});

Deno.test("update and delete my own task", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  const task = await makeTask(app, token, { title: "Draft", priority: "low" });

  const put = await send(app, "PUT", `/api/tasks/${task.id}`, {
    title: "Final",
    status: "done",
    priority: "high",
    dueDate: "2026-11-20",
  }, token);
  assertEquals(put.status, 200);
  const updated = await put.json();
  assertEquals(
    [updated.title, updated.status, updated.priority, updated.dueDate],
    ["Final", "done", "high", "2026-11-20"],
  );

  const del = await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, token);
  assertEquals(del.status, 200);
  assertEquals(await del.json(), { ok: true });
  const gone = await send(app, "GET", `/api/tasks/${task.id}`, undefined, token);
  assertEquals(gone.status, 404);
});

Deno.test("pagination: page 2 with limit 2 holds the third task", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  for (const title of ["first", "second", "third"]) {
    await makeTask(app, token, { title });
  }
  const res = await send(app, "GET", "/api/tasks?page=2&limit=2", undefined, token);
  assertEquals(res.status, 200);
  const page = await res.json();
  assertEquals(page.page, 2);
  assertEquals(page.limit, 2);
  assertEquals(page.total, 3);
  assertEquals(page.items.map((t: { title: string }) => t.title), ["third"]);
});

Deno.test("filter by status, and the total counts only the filtered tasks", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  await makeTask(app, token, { title: "a", status: "done" });
  await makeTask(app, token, { title: "b" });
  await makeTask(app, token, { title: "c", status: "done" });
  const res = await send(app, "GET", "/api/tasks?status=done", undefined, token);
  const page = await res.json();
  assertEquals(page.total, 2);
  assertEquals(page.items.map((t: { title: string }) => t.title), ["a", "c"]);
});

Deno.test("bad query values are 400, not a crash", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  for (const q of ["page=abc", "limit=1000", "page=0", "status=finished"]) {
    const res = await send(app, "GET", `/api/tasks?${q}`, undefined, token);
    assertEquals(res.status, 400, q);
    assertEquals((await res.json()).error, "validation failed", q);
  }
});

Deno.test("an unknown route and a non-numeric id are 404 in the same shape", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  const unknown = await send(app, "GET", "/nothing-here");
  const badId = await send(app, "GET", "/api/tasks/abc", undefined, token);
  assertEquals(unknown.status, 404);
  assertEquals(await unknown.json(), { error: "not found", issues: [] });
  assertEquals(badId.status, 404);
  assertEquals((await badId.json()).error, "task not found");
});
