// Meryem Esma Eröz, 2200005798
// Bonus 4: the index exists and the task queries use it.
import { assertEquals } from "@std/assert";
import { createDb, migrate } from "../src/db.ts";

async function freshDb() {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const database = createDb(`file:${file}`);
  await migrate(database);
  return database;
}

Deno.test("migrate() creates idx_tasks_user_status on (user_id, status)", async () => {
  const { client } = await freshDb();
  const res = await client.execute("PRAGMA index_info('idx_tasks_user_status')");
  assertEquals(res.rows.map((r) => r.name), ["user_id", "status"]);
});

Deno.test("the list query of the API searches with the index instead of a scan", async () => {
  const { client } = await freshDb();
  // the shape of GET /api/tasks?status=done, and of the count for "total"
  const queries: [string, (number | string)[]][] = [
    ["SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status = ?", [
      1,
      "done",
    ]],
    ["SELECT count(*) FROM tasks WHERE user_id = ? AND deleted_at IS NULL", [1]],
  ];
  for (const [sql, args] of queries) {
    const plan = await client.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args });
    const detail = plan.rows.map((r) => String(r.detail)).join(" | ");
    assertEquals(detail.includes("USING INDEX idx_tasks_user_status"), true, detail);
  }
});
