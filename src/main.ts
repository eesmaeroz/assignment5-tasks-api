// Meryem Esma Eröz, 2200005798
import { createApp } from "./app.ts";
import { createDb, migrate } from "./db.ts";
import { type Config, ConfigError, loadConfig } from "./config.ts";

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
Deno.serve({ port: config.PORT }, createApp(db).fetch);
