// Meryem Esma Eröz, 2200005798
// Bonus 5: the seed fills an empty database and is harmless the second time.
import { assertEquals } from "@std/assert";
import { count } from "drizzle-orm";
import { createDb, migrate } from "../src/db.ts";
import { tasks, users } from "../src/schema.ts";
import { DEMO_PASSWORD, DEMO_USERS, seed } from "../scripts/seed.ts";
import { createApp } from "../src/app.ts";
import { send } from "./helpers.ts";

async function freshDb() {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const database = createDb(`file:${file}`);
  await migrate(database);
  return database;
}

const totals = async (database: Awaited<ReturnType<typeof freshDb>>) => {
  const [{ u }] = await database.db.select({ u: count() }).from(users);
  const [{ t }] = await database.db.select({ t: count() }).from(tasks);
  return { users: u, tasks: t };
};

Deno.test("seed fills an empty database, and a second run adds nothing", async () => {
  const database = await freshDb();
  const expectedTasks = DEMO_USERS.reduce((sum, u) => sum + u.tasks.length, 0);

  assertEquals(await seed(database), { users: 2, tasks: expectedTasks });
  assertEquals(await totals(database), { users: 2, tasks: expectedTasks });

  assertEquals(await seed(database), { users: 0, tasks: 0 });
  assertEquals(await totals(database), { users: 2, tasks: expectedTasks });
});

Deno.test("seed does not touch a real user who registered first", async () => {
  const database = await freshDb();
  const app = createApp(database);
  await send(app, "POST", "/auth/register", {
    email: "esma@example.com",
    password: "kediler123",
  });
  await seed(database);
  // the real user can still log in with her own password, and has no demo tasks
  // (only her own welcome task from registering)
  const login = await send(app, "POST", "/auth/login", {
    email: "esma@example.com",
    password: "kediler123",
  });
  const { token } = await login.json();
  const list = await send(app, "GET", "/api/tasks", undefined, token);
  const page = await list.json();
  assertEquals(page.items.map((t: { title: string }) => t.title), [
    "Welcome! Add your first task",
  ]);
});

Deno.test("a demo user can log in and sees a full first page", async () => {
  const database = await freshDb();
  await seed(database);
  const app = createApp(database);
  const login = await send(app, "POST", "/auth/login", {
    email: "demo.esma@example.com",
    password: DEMO_PASSWORD,
  });
  assertEquals(login.status, 200);
  const { token } = await login.json();
  const page = await (await send(app, "GET", "/api/tasks?limit=5", undefined, token))
    .json();
  assertEquals([page.items.length, page.total], [5, 11]);
});
