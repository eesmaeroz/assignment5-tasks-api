// Meryem Esma Eröz, 2200005798
import { createApp } from "./app.ts";
import { createDbPool, migrate } from "./db.ts";
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

// Bonus 6: POOL_SIZE clients on the same database; every request borrows one.
const pool = await createDbPool(config.DATABASE_URL, config.POOL_SIZE);
const db = await pool.use(async (first) => {
  await migrate(first);
  return first;
});

console.log(`APP_ENV=${config.APP_ENV}, database ${config.DATABASE_URL}`);

// Bonus 16: open KV once, for the whole process.
const kv = await Deno.openKv(config.KV_PATH);
const cache = new TaskCache(kv);

const app = createApp(db, {
  adminEmail: config.ADMIN_EMAIL,
  jwtSecret: config.JWT_SECRET,
  cache,
  uploadDir: config.UPLOAD_DIR,
  pool,
});

// Bonus 14: the nightly cleanup. Needs --unstable-cron (it is in the deno.json tasks).
Deno.cron("purge old done tasks", config.PURGE_CRON, async () => {
  const removed = await pool.use((d) =>
    purgeOldDone(d, 30, { cache, uploadDir: config.UPLOAD_DIR })
  );
  console.log(JSON.stringify({ time: new Date().toISOString(), job: "purge", removed }));
});

Deno.serve({ port: config.PORT }, app.fetch);
