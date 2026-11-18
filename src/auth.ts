// Meryem Esma Eröz, 2200005798
import bcrypt from "bcryptjs";
import type { MiddlewareHandler } from "hono";
import type { Role } from "./schema.ts";
import { verifyToken } from "./jwt.ts";

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// Bonus 7: the given session functions (createSession, userIdFromToken) and the sessions
// table are gone; a signed token (src/jwt.ts) replaces them.

/**
 * What the middlewares store for the routes: the request id (Bonus 10, set for every
 * request), and for /api routes the id and the role of the logged-in user (Bonus 9).
 */
export type Env = { Variables: { requestId: string; userId: number; role: Role } };

/**
 * Bonus 7: the middleware checks a signed token (JWT) instead of looking a session up in the
 * database. No header, a header without "Bearer ", or a bad, tampered or expired token all
 * give 401. The user id and (Bonus 9) the role come from the token itself.
 */
export const requireAuth =
  (secret: string): MiddlewareHandler<Env> => async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : "";
    const user = token ? await verifyToken(token, secret) : null;
    if (user === null) {
      return c.json({ error: "unauthorized", issues: [] }, 401);
    }
    c.set("userId", user.userId);
    c.set("role", user.role);
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
