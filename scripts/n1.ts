// Meryem Esma Eröz, 2200005798
// Bonus 3: count the queries of the naive and the grouped summary.
//   deno task n1
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Logger } from "drizzle-orm/logger";
import { migrate } from "../src/db.ts";
import * as schema from "../src/schema.ts";
import { tasks, users } from "../src/schema.ts";
import { summaryGrouped, summaryNaive } from "../src/summary.ts";

/** A Drizzle logger that counts the queries and remembers the SQL. */
class CountingLogger implements Logger {
  queries: string[] = [];
  logQuery(query: string): void {
    this.queries.push(query);
  }
}

async function measure(taskCount: number) {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const client = createClient({ url: `file:${file}` });
  const logger = new CountingLogger();
  const database = { client, db: drizzle(client, { schema, logger }) };
  await migrate(database);

  const [user] = await database.db.insert(users)
    .values({ email: "esma@example.com", passwordHash: "x" }).returning();
  const statuses = ["todo", "in-progress", "done"] as const;
  await database.db.insert(tasks).values(
    Array.from({ length: taskCount }, (_, i) => ({
      userId: user.id,
      title: `task ${i + 1}`,
      status: statuses[i % 3],
    })),
  );

  logger.queries = [];
  let start = performance.now();
  const naive = await summaryNaive(database, user.id);
  const naiveMs = performance.now() - start;
  const naiveQueries = logger.queries;

  logger.queries = [];
  start = performance.now();
  const grouped = await summaryGrouped(database, user.id);
  const groupedMs = performance.now() - start;
  const groupedQueries = logger.queries;

  client.close();
  return { naive, naiveQueries, naiveMs, grouped, groupedQueries, groupedMs };
}

for (const n of [10, 100, 1000]) {
  const r = await measure(n);
  const same = JSON.stringify(r.naive) === JSON.stringify(r.grouped);
  console.log(
    `${n} tasks: naive ${r.naiveQueries.length} queries (${r.naiveMs.toFixed(1)} ms), ` +
      `grouped ${r.groupedQueries.length} query (${
        r.groupedMs.toFixed(1)
      } ms), same answer: ${same}`,
  );
  if (n === 10) {
    console.log("  naive, first 3 queries:");
    for (const q of r.naiveQueries.slice(0, 3)) console.log(`    ${q}`);
    console.log("  grouped:");
    for (const q of r.groupedQueries) console.log(`    ${q}`);
    console.log("  answer:", JSON.stringify(r.grouped));
  }
}
