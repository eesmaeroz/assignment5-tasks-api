// Meryem Esma Eröz, 2200005798
// Bonus 3: GET /api/me/summary.
import { assertEquals } from "@std/assert";
import { createDb, migrate } from "../src/db.ts";
import { summaryGrouped, summaryNaive } from "../src/summary.ts";
import { tasks, users } from "../src/schema.ts";
import { freshApp, login, makeTask, send } from "./helpers.ts";

Deno.test("summary counts my tasks per status (welcome task included)", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com"); // + 1 todo (welcome)
  await makeTask(app, token, { title: "a", status: "done" });
  await makeTask(app, token, { title: "b", status: "done" });
  await makeTask(app, token, { title: "c", status: "in-progress" });
  const res = await send(app, "GET", "/api/me/summary", undefined, token);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { "todo": 1, "in-progress": 1, "done": 2, total: 4 });
});

Deno.test("summary leaves out deleted tasks and other users' tasks", async () => {
  const app = await freshApp();
  const esma = await login(app, "esma@example.com");
  const mery = await login(app, "mery@example.com");
  const gone = await makeTask(app, esma, { title: "gone", status: "done" });
  await send(app, "DELETE", `/api/tasks/${gone.id}`, undefined, esma);
  await makeTask(app, mery, { title: "Mery's", status: "done" });
  const res = await send(app, "GET", "/api/me/summary", undefined, esma);
  assertEquals(await res.json(), { "todo": 1, "in-progress": 0, "done": 0, total: 1 });
});

Deno.test("summary without a token is 401", async () => {
  const app = await freshApp();
  assertEquals((await send(app, "GET", "/api/me/summary")).status, 401);
});

Deno.test("the naive and the grouped summary give the same answer", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const database = createDb(`file:${file}`);
  await migrate(database);
  const [user] = await database.db.insert(users)
    .values({ email: "x@example.com", passwordHash: "x" }).returning();
  const statuses = ["todo", "in-progress", "done", "done"] as const;
  await database.db.insert(tasks).values(
    statuses.map((status, i) => ({ userId: user.id, title: `t${i}`, status })),
  );
  const grouped = await summaryGrouped(database, user.id);
  assertEquals(grouped, { "todo": 1, "in-progress": 1, "done": 2, total: 4 });
  assertEquals(await summaryNaive(database, user.id), grouped);
});
