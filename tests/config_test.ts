// Meryem Esma Eröz, 2200005798
// Bonus 11: health, readiness and configuration.
import { assertEquals, assertThrows } from "@std/assert";
import { createApp } from "../src/app.ts";
import { createDb, migrate } from "../src/db.ts";
import { ConfigError, loadConfig } from "../src/config.ts";
import { freshApp } from "./helpers.ts";

Deno.test("GET /healthz is 200 without a token", async () => {
  const app = await freshApp();
  const res = await app.request("/healthz");
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
});

Deno.test("GET /readyz is 200 when the database answers", async () => {
  const app = await freshApp();
  const res = await app.request("/readyz");
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ready: true });
});

Deno.test("GET /readyz is 503 when the database is gone, /healthz is still 200", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const database = createDb(`file:${file}`);
  await migrate(database);
  const app = createApp(database, { log: () => {} });
  database.client.close(); // simulate a lost database connection
  const ready = await app.request("/readyz");
  assertEquals(ready.status, 503);
  assertEquals(await ready.json(), { error: "database not reachable", issues: [] });
  assertEquals((await app.request("/healthz")).status, 200);
});

Deno.test("config: defaults for development", () => {
  assertEquals(loadConfig({}), {
    APP_ENV: "development",
    PORT: 8000,
    DATABASE_URL: "file:./tasks.db",
    JWT_SECRET: "change-me",
    PURGE_CRON: "0 3 * * *",
  });
});

Deno.test("config: PURGE_CRON must have five fields (Bonus 14)", () => {
  assertEquals(loadConfig({ PURGE_CRON: "* * * * *" }).PURGE_CRON, "* * * * *");
  assertThrows(
    () => loadConfig({ PURGE_CRON: "every night" }),
    ConfigError,
    "PURGE_CRON: must be a cron expression with five fields",
  );
});

Deno.test("config: values are read and converted", () => {
  const config = loadConfig({
    APP_ENV: "test",
    PORT: "9001",
    DATABASE_URL: "file:./t.db",
  });
  assertEquals([config.APP_ENV, config.PORT, config.DATABASE_URL], [
    "test",
    9001,
    "file:./t.db",
  ]);
});

Deno.test("config: a bad PORT, APP_ENV or DATABASE_URL is refused with a clear message", () => {
  const error = assertThrows(
    () => loadConfig({ PORT: "eighty", APP_ENV: "staging", DATABASE_URL: "tasks.db" }),
    ConfigError,
  );
  const message = error.message;
  for (const name of ["PORT", "APP_ENV", "DATABASE_URL"]) {
    assertEquals(message.includes(`${name}:`), true, `${name} missing in:\n${message}`);
  }
});

Deno.test("config: production refuses the default secret and a short one", () => {
  assertThrows(
    () => loadConfig({ APP_ENV: "production", JWT_SECRET: "change-me" }),
    ConfigError,
    "the default development secret is not allowed in production",
  );
  assertThrows(
    () => loadConfig({ APP_ENV: "production" }), // no secret at all: the default is used
    ConfigError,
    "not allowed in production",
  );
  assertThrows(
    () => loadConfig({ APP_ENV: "production", JWT_SECRET: "short" }),
    ConfigError,
    "at least 32 characters",
  );
  const ok = loadConfig({ APP_ENV: "production", JWT_SECRET: "x".repeat(32) });
  assertEquals(ok.APP_ENV, "production");
});
