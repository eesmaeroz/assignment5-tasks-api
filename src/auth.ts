// Meryem Esma Eröz, 2200005798
import bcrypt from "bcryptjs";
import type { MiddlewareHandler } from "hono";
import type { Db } from "./db.ts";

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

const SESSION_SECONDS = 60 * 60; // a session lives for one hour

/** Log a user in: store a random token for them and return it. */
export async function createSession(db: Db, userId: number): Promise<string> {
  const token = crypto.randomUUID();
  await db.client.execute({
    sql:
      "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, strftime('%s','now') + ?)",
    args: [token, userId, SESSION_SECONDS],
  });
  return token;
}

/** Return the user id that owns a valid, unexpired token, or null. */
export async function userIdFromToken(db: Db, token: string): Promise<number | null> {
  const res = await db.client.execute({
    sql:
      "SELECT user_id FROM sessions WHERE token = ? AND expires_at > strftime('%s','now')",
    args: [token],
  });
  const id = res.rows[0]?.user_id;
  return id === undefined ? null : Number(id);
}

/** What the middleware stores for the routes: the id of the logged-in user. */
export type Env = { Variables: { userId: number } };

/**
 * A middleware factory: it needs the database, so it takes db and returns the middleware.
 * No header, a header without "Bearer ", or an unknown or expired token all give 401.
 */
export const requireAuth = (db: Db): MiddlewareHandler<Env> => async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const id = token ? await userIdFromToken(db, token) : null;
  if (id === null) {
    return c.json({ error: "unauthorized", issues: [] }, 401);
  }
  c.set("userId", id);
  await next();
};
