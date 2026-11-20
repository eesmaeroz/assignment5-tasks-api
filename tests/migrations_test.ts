// Meryem Esma Eröz, 2200005798
// Bonus 1: the tables come from the migration files that Drizzle Kit generated.
import { assertEquals, assertRejects } from "@std/assert";
import { migrate as runMigrations } from "drizzle-orm/libsql/migrator";
import { createDb, type Db, migrate } from "../src/db.ts";

const DRIZZLE = new URL("../drizzle/", import.meta.url);

async function sqlFiles() {
  const names: string[] = [];
  for await (const e of Deno.readDir(DRIZZLE)) {
    if (e.name.endsWith(".sql")) names.push(e.name);
  }
  return names.sort();
}

async function emptyDb() {
  return createDb(`file:${await Deno.makeTempFile({ suffix: ".db" })}`);
}

const columns = async ({ client }: Db, table: string) =>
  (await client.execute(`PRAGMA table_info(${table})`)).rows.map((r) => r.name);

Deno.test("drizzle/ has two migrations: the tables, then one ALTER TABLE", async () => {
  const files = await sqlFiles();
  assertEquals(files.length, 2);
  assertEquals(files.map((f) => f.slice(0, 5)), ["0000_", "0001_"]);
  const first = await Deno.readTextFile(new URL(files[0], DRIZZLE));
  const second = await Deno.readTextFile(new URL(files[1], DRIZZLE));
  assertEquals(first.includes("CREATE TABLE `tasks`"), true);
  assertEquals(first.includes("CREATE TABLE `users`"), true);
  assertEquals(second.trim(), "ALTER TABLE `tasks` ADD `updated_at` integer;");
});

Deno.test("migrate() runs every file once: a second call changes nothing", async () => {
  const database = await emptyDb();
  await migrate(database);
  await migrate(database);
  const done = await database.client.execute(
    "SELECT count(*) AS n FROM __drizzle_migrations",
  );
  assertEquals(done.rows[0].n, 2);
  assertEquals((await columns(database, "tasks")).includes("updated_at"), true);
});

Deno.test("an old database (only the first migration) is upgraded and keeps its rows", async () => {
  // a copy of drizzle/ that knows only the first file, as the project was before
  const old = await Deno.makeTempDir();
  const [first] = await sqlFiles();
  await Deno.mkdir(`${old}/meta`);
  await Deno.copyFile(new URL(first, DRIZZLE), `${old}/${first}`);
  const journal = JSON.parse(
    await Deno.readTextFile(new URL("meta/_journal.json", DRIZZLE)),
  );
  journal.entries = journal.entries.slice(0, 1);
  await Deno.writeTextFile(`${old}/meta/_journal.json`, JSON.stringify(journal));

  const database = await emptyDb();
  await runMigrations(database.db, { migrationsFolder: old });
  assertEquals((await columns(database, "tasks")).includes("updated_at"), false);
  await database.client.execute(
    "INSERT INTO users (email, password_hash) VALUES ('e@x.y', 'h')",
  );
  await database.client.execute("INSERT INTO tasks (user_id, title) VALUES (1, 'kept')");

  await migrate(database); // now with both files: only the second one runs
  assertEquals((await columns(database, "tasks")).includes("updated_at"), true);
  const rows = await database.client.execute("SELECT title, updated_at FROM tasks");
  assertEquals(rows.rows.map((r) => [r.title, r.updated_at]), [["kept", null]]);
});

Deno.test("the CHECKs came along: the database refuses an unknown status", async () => {
  const database = await emptyDb();
  await migrate(database);
  await database.client.execute(
    "INSERT INTO users (email, password_hash) VALUES ('e@x.y', 'h')",
  );
  await assertRejects(
    () =>
      database.client.execute(
        "INSERT INTO tasks (user_id, title, status) VALUES (1, 'x', 'later')",
      ),
    Error,
    "CHECK constraint failed",
  );
});

Deno.test("updated_at is null for a new task and set by a change", async () => {
  const { freshApp, login, makeTask, send } = await import("./helpers.ts");
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  const task = await makeTask(app, token, { title: "A5" });
  assertEquals(task.updatedAt, null);
  const res = await send(app, "PUT", `/api/tasks/${task.id}`, { title: "A5!" }, token);
  assertEquals(typeof (await res.json()).updatedAt, "number");
});
