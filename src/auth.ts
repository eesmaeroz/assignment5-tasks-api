// Meryem Esma Eröz, 2200005798
import bcrypt from "bcryptjs";
import type { MiddlewareHandler } from "hono";
import type { Db } from "./db.ts";
import type { Role } from "./schema.ts";

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

/**
 * What the middlewares store for the routes: the request id (Bonus 10, set for every
 * request), and for /api routes the id and the role of the logged-in user (Bonus 9).
 */
export type Env = { Variables: { requestId: string; userId: number; role: Role } };

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
  // Bonus 9: the role is read from the users table on every request, so a change of
  // role works at once, without logging in again.
  const res = await db.client.execute({
    sql: "SELECT role FROM users WHERE id = ?",
    args: [id],
  });
  const role = res.rows[0]?.role;
  if (role !== "user" && role !== "admin") {
    return c.json({ error: "unauthorized", issues: [] }, 401);
  }
  c.set("userId", id);
  c.set("role", role);
  await next();
};

/**
 * Bonus 9: only these roles may pass. 401 when nobody is logged in (no role was set),
 * 403 when somebody is logged in but their role is not allowed.
 */
export const requireRole =
  (...roles: Role[]): MiddlewareHandler<Env> => async (c, next) => {
    const role = c.get("role");
    if (!role) return c.json({ error: "unauthorized", issues: [] }, 401);
    if (!roles.includes(role)) return c.json({ error: "forbidden", issues: [] }, 403);
    await next();
  };
