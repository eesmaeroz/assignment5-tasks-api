// Meryem Esma Eröz, 2200005798
import { drizzle } from "drizzle-orm/libsql/web";
// only a type: erased when the code runs, so it does not load the native driver
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { type Client, createClient as createRemoteClient } from "@libsql/client/web";
import * as schema from "./schema.ts";
import type { Logger } from "drizzle-orm/logger";
import { Pool } from "./pool.ts";
import { migrate as runMigrations } from "drizzle-orm/libsql/migrator";

export type Db = { db: LibSQLDatabase<typeof schema>; client: Client };

export type DbOptions = {
  /** Tests pass a Drizzle logger to count the queries (Bonus 16). */
  logger?: Logger;
  /** Bonus 19: the token of a hosted libSQL database (Turso); never for a file. */
  authToken?: string;
};

/**
 * Open a database: a file (file:./tasks.db, the tests use temporary files) or, since
 * Bonus 19, a hosted libSQL database (libsql://...turso.io) with its token.
 *
 * The normal "@libsql/client" loads libSQL's native library as soon as it is imported,
 * even for a remote URL (tried: it asks for --allow-sys and --allow-ffi at once). A remote
 * database needs only HTTP, so "@libsql/client/web" (fetch) is used for it, and the native
 * client is imported only when a file is opened. That keeps native code out of Deno Deploy.
 */
export async function createDb(url: string, options: DbOptions = {}): Promise<Db> {
  const client = url.startsWith("file:")
    ? (await import("@libsql/client")).createClient({ url })
    : createRemoteClient({ url, authToken: options.authToken });
  const db = drizzle(client, { schema, logger: options.logger });
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
  options: DbOptions & { timeoutMs?: number } = {},
) {
  const items = await Promise.all(
    Array.from({ length: size }, () => createDb(url, options)),
  );
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
