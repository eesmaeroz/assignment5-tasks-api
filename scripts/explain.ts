// Meryem Esma Eröz, 2200005798
// Bonus 4: the same query with and without an index, with the query plan and the time.
//   deno task explain
import { createDb, migrate } from "../src/db.ts";
import { tasks, users } from "../src/schema.ts";

const USERS = 20;
const TASKS_PER_USER = 1000; // 20,000 tasks
const RUNS = 200;
const QUERY = "SELECT * FROM tasks WHERE user_id = ? AND status = ?";
// the same rows, but only counted: no rows to send back, so the search itself is measured
const COUNT = "SELECT count(*) AS n FROM tasks WHERE user_id = ? AND status = ?";
const ARGS = [7, "done"];

const file = await Deno.makeTempFile({ suffix: ".db" });
const database = await createDb(`file:${file}`);
const { client, db } = database;
await migrate(database);
// migrate() creates the index; drop it to start from the "before" state
await client.execute("DROP INDEX IF EXISTS idx_tasks_user_status");

// Fill: 20 users, 1000 tasks each, inserted in batches of 500 rows
const created = await db.insert(users).values(
  Array.from(
    { length: USERS },
    (_, i) => ({ email: `user${i + 1}@example.com`, passwordHash: "x" }),
  ),
).returning({ id: users.id });
const statuses = ["todo", "in-progress", "done"] as const;
const rows = created.flatMap((u) =>
  Array.from({ length: TASKS_PER_USER }, (_, i) => ({
    userId: u.id,
    title: `task ${i + 1}`,
    status: statuses[i % 3],
  }))
);
for (let i = 0; i < rows.length; i += 500) {
  await db.insert(tasks).values(rows.slice(i, i + 500));
}
const total = (await client.execute("SELECT count(*) AS n FROM tasks")).rows[0].n;
console.log(`filled: ${USERS} users, ${total} tasks`);

async function plan() {
  const res = await client.execute({ sql: `EXPLAIN QUERY PLAN ${QUERY}`, args: ARGS });
  return res.rows.map((r) => String(r.detail)).join(" | ");
}

async function time(sql: string) {
  await client.execute({ sql, args: ARGS }); // warm-up, not measured
  const start = performance.now();
  for (let i = 0; i < RUNS; i++) await client.execute({ sql, args: ARGS });
  return (performance.now() - start) / RUNS;
}

const fileKiB = async () => ((await Deno.stat(file)).size / 1024).toFixed(0);

console.log(`query: ${QUERY}   args: ${JSON.stringify(ARGS)}`);
const rowsFound = (await client.execute({ sql: QUERY, args: ARGS })).rows.length;
console.log(`rows found: ${rowsFound}`);

const beforeSelect = await time(QUERY);
const beforeCount = await time(COUNT);
const sizeBefore = await fileKiB();
console.log(`before: ${await plan()}`);
console.log(
  `before: SELECT * ${beforeSelect.toFixed(3)} ms, count(*) ${
    beforeCount.toFixed(3)
  } ms (average of ${RUNS})`,
);

await client.execute("CREATE INDEX idx_tasks_user_status ON tasks(user_id, status)");
const afterSelect = await time(QUERY);
const afterCount = await time(COUNT);
const sizeAfter = await fileKiB();
console.log(`after:  ${await plan()}`);
console.log(
  `after:  SELECT * ${afterSelect.toFixed(3)} ms, count(*) ${
    afterCount.toFixed(3)
  } ms (average of ${RUNS})`,
);
console.log(
  `faster: SELECT * ${(beforeSelect / afterSelect).toFixed(1)}x, count(*) ${
    (beforeCount / afterCount).toFixed(1)
  }x`,
);
console.log(
  `database file: ${sizeBefore} KiB without the index, ${sizeAfter} KiB with it`,
);
client.close();
