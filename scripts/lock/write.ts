// Meryem Esma Eröz, 2200005798
// Bonus 6: try one INSERT with the busy_timeout given as the argument (in ms).
import { createClient } from "@libsql/client";

const ms = Number(Deno.args[0] ?? "0");
const url = Deno.env.get("LOCK_DB") ?? "file:./lock-demo.db";
const c = createClient({ url });
await c.execute(`PRAGMA busy_timeout = ${ms}`);
const start = performance.now();
try {
  await c.execute("INSERT INTO t VALUES (2)");
  console.log(
    `writer (busy_timeout=${ms}): ok after ${Math.round(performance.now() - start)} ms`,
  );
} catch (e) {
  console.log(`writer (busy_timeout=${ms}): ${(e as Error).message}`);
}
