// Meryem Esma Eröz, 2200005798
// Bonus 6: keep a write transaction open for 2 s, so another process finds the file locked.
//   deno run -A scripts/lock/hold.ts & deno run -A scripts/lock/write.ts 0
import { createClient } from "@libsql/client";

const url = Deno.env.get("LOCK_DB") ?? "file:./lock-demo.db";
const c = createClient({ url });
await c.execute("PRAGMA journal_mode = WAL");
await c.execute("CREATE TABLE IF NOT EXISTS t (x)");
const tx = await c.transaction("write");
await tx.execute("INSERT INTO t VALUES (1)");
console.log("holder: write lock taken, keeping it for 2 s");
await new Promise((r) => setTimeout(r, 2000));
await tx.commit();
console.log("holder: committed");
