// Meryem Esma Eröz, 2200005798
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema.ts";
import type { Logger } from "drizzle-orm/logger";
import { Pool } from "./pool.ts";

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

/** Create the tables if they do not exist yet. Keep this in sync with schema.ts. */
export async function migrate({ client }: Db) {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       email TEXT NOT NULL UNIQUE,
       password_hash TEXT NOT NULL,
       role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
       created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
     )`,
    // Bonus 7: no sessions table any more; login returns a signed token (src/jwt.ts).
    // The CHECKs repeat the Zod rules in the database, so even a bad INSERT written by
    // hand cannot store an unknown status or priority.
    `CREATE TABLE IF NOT EXISTS tasks (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id INTEGER NOT NULL REFERENCES users(id),
       title TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'todo'
         CHECK (status IN ('todo', 'in-progress', 'done')),
       priority TEXT NOT NULL DEFAULT 'medium'
         CHECK (priority IN ('low', 'medium', 'high')),
       due_date TEXT,
       created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
       deleted_at INTEGER,
       done_at INTEGER,
       attachment TEXT
     )`,
    // Bonus 4: the index for "my tasks" and "my tasks with this status".
    `CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status)`,
  ]);
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
