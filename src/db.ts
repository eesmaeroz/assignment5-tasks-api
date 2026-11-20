// Meryem Esma Eröz, 2200005798
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema.ts";
import type { Logger } from "drizzle-orm/logger";
import { Pool } from "./pool.ts";
import { migrate as runMigrations } from "drizzle-orm/libsql/migrator";

export type Db = ReturnType<typeof createDb>;

/**
 * Open a database. Tests pass a temporary file, and a Drizzle logger when they want to
 * count the queries (Bonus 16).
 */
export function createDb(url: string, logger?: Logger) {
  const client = createClient({ url });
  const db = drizzle(client, { schema, logger });
  return { db, client };
}

/**
 * The drizzle/ folder next to src/, found from this file and not from the current folder,
 * so tests and scripts work from anywhere. (On Windows a file URL is /C:/..., so the first
 * slash goes.)
 */
const MIGRATIONS = (() => {
  const path = decodeURIComponent(new URL("../drizzle", import.meta.url).pathname);
  return Deno.build.os === "windows" ? path.slice(1) : path;
})();

/**
 * Bonus 1: bring the database up to date with the migration files in drizzle/, which
 * Drizzle Kit generates from schema.ts. Drizzle remembers in the table
 * __drizzle_migrations which files ran already, so every file runs once.
 */
export async function migrate({ db }: Db) {
  await runMigrations(db, { migrationsFolder: MIGRATIONS });
}

/**
 * Bonus 6 (option B): `size` clients on the same database, each with its own Drizzle.
 * For a file: WAL mode (readers do not block the writer; it is stored in the file, so once
 * is enough) and busy_timeout (a locked file means "wait up to 5 s", not SQLITE_BUSY).
 */
export async function createDbPool(
  url: string,
  size: number,
  options: { timeoutMs?: number; logger?: Logger } = {},
) {
  const items = Array.from({ length: size }, () => createDb(url, options.logger));
  const isFile = url.startsWith("file:");
  if (isFile) await items[0].client.execute("PRAGMA journal_mode = WAL");
  return new Pool(items, {
    timeoutMs: options.timeoutMs,
    // busy_timeout belongs to ONE connection, and libSQL opens a new connection after a
    // transaction (tried: 5000 before, 0 after). So it is set every time a client is lent.
    onAcquire: isFile
      ? async ({ client }) => {
        await client.execute("PRAGMA busy_timeout = 5000");
      }
      : undefined,
  });
}

export type DbPool = Pool<Db>;
