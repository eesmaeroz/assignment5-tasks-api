// Meryem Esma Eröz, 2200005798
// Bonus 6 (option B): the pool of my own, alone and in front of the database.
import { assertEquals, assertRejects } from "@std/assert";
import { count } from "drizzle-orm";
import { Pool, PoolTimeoutError } from "../src/pool.ts";
import { createDbPool, migrate } from "../src/db.ts";
import { createApp } from "../src/app.ts";
import { tasks } from "../src/schema.ts";
import { login, send } from "./helpers.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.test("20 jobs on a pool of 3: never more than 3 at once, and all 20 finish", async () => {
  const pool = new Pool(["a", "b", "c"]);
  let running = 0;
  let most = 0;
  const done: number[] = [];

  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      pool.use(async () => {
        running++;
        most = Math.max(most, running);
        await sleep(5 + (i % 4) * 3); // different lengths, so the order mixes
        running--;
        done.push(i);
      })),
  );
  assertEquals(most, 3);
  assertEquals(done.length, 20);
  assertEquals([pool.inUse, pool.waiting], [0, 0]);
});

Deno.test("release hands the item to the waiter that came first", async () => {
  const pool = new Pool(["only"]);
  const first = await pool.acquire();
  const order: string[] = [];
  const a = pool.acquire().then((x) => order.push(`A got ${x}`));
  const b = pool.acquire().then((x) => order.push(`B got ${x}`));
  assertEquals(pool.waiting, 2);
  pool.release(first);
  await a;
  pool.release("only");
  await b;
  assertEquals(order, ["A got only", "B got only"]);
});

Deno.test("use() gives the item back even when the job throws", async () => {
  const pool = new Pool([1]);
  await assertRejects(
    () => pool.use(() => Promise.reject(new Error("boom"))),
    Error,
    "boom",
  );
  assertEquals(pool.inUse, 0);
  assertEquals(await pool.use((x) => Promise.resolve(x + 1)), 2); // still usable
});

Deno.test("when every item stays busy, acquire() gives up after the timeout", async () => {
  const pool = new Pool(["x"], { timeoutMs: 30 });
  const held = await pool.acquire();
  await assertRejects(() => pool.acquire(), PoolTimeoutError);
  assertEquals(pool.waiting, 0); // the timed-out waiter is not left in the queue
  pool.release(held);
  assertEquals(pool.inUse, 0);
});

Deno.test("the app answers 503 when the pool is exhausted", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const pool = await createDbPool(`file:${file}`, 1, { timeoutMs: 30 });
  await pool.use((db) => migrate(db));
  const app = createApp(await pool.use((db) => Promise.resolve(db)), {
    pool,
    log: () => {},
  });
  const token = await login(app, "esma@example.com");
  const held = await pool.acquire(); // somebody keeps the only client
  const res = await send(app, "GET", "/api/tasks", undefined, token);
  assertEquals(res.status, 503);
  assertEquals(res.headers.get("retry-after"), "1");
  assertEquals((await res.json()).error, "database busy, try again");
  pool.release(held);
  assertEquals((await send(app, "GET", "/api/tasks", undefined, token)).status, 200);
});

Deno.test("a real pool of 3 clients on one WAL file: 30 creates at once all succeed", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const pool = await createDbPool(`file:${file}`, 3);
  const first = await pool.use(async (db) => {
    await migrate(db);
    return db;
  });
  const mode = await first.client.execute("PRAGMA journal_mode");
  assertEquals(mode.rows[0][0], "wal");

  const app = createApp(first, { pool, log: () => {} });
  const token = await login(app, "esma@example.com"); // + 1 welcome task
  const results = await Promise.all(
    Array.from(
      { length: 30 },
      (_, i) => send(app, "POST", "/api/tasks", { title: `task ${i}` }, token),
    ),
  );
  assertEquals(results.map((r) => r.status), Array(30).fill(201));
  const [{ n }] = await first.db.select({ n: count() }).from(tasks);
  assertEquals(n, 31);
  assertEquals(pool.inUse, 0);
});
