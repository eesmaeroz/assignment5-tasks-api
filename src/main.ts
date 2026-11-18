// Meryem Esma Eröz, 2200005798
import { createApp } from "./app.ts";
import { createDb, migrate } from "./db.ts";
import { type Config, ConfigError, loadConfig } from "./config.ts";
import { TaskCache } from "./cache.ts";
import { purgeOldDone } from "./purge.ts";

// Bonus 11: read and check every setting once, and stop with a clear message if one is wrong.
let config: Config;
try {
  config = loadConfig(Deno.env.toObject());
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  Deno.exit(1);
}

const db = createDb(config.DATABASE_URL);
await migrate(db);

console.log(`APP_ENV=${config.APP_ENV}, database ${config.DATABASE_URL}`);

// Bonus 16: open KV once, for the whole process.
const kv = await Deno.openKv(config.KV_PATH);
const cache = new TaskCache(kv);

const app = createApp(db, {
  adminEmail: config.ADMIN_EMAIL,
  jwtSecret: config.JWT_SECRET,
  cache,
});

// Bonus 14: the nightly cleanup. Needs --unstable-cron (it is in the deno.json tasks).
Deno.cron("purge old done tasks", config.PURGE_CRON, async () => {
  const removed = await purgeOldDone(db, 30, { cache });
  console.log(JSON.stringify({ time: new Date().toISOString(), job: "purge", removed }));
});

Deno.serve({ port: config.PORT }, app.fetch);
