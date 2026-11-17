// Meryem Esma Eröz, 2200005798
import { type Context, Hono } from "hono";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db.ts";
import { PRIORITIES, STATUSES, tasks, users } from "./schema.ts";
import {
  checkPassword,
  createSession,
  type Env,
  hashPassword,
  requireAuth,
} from "./auth.ts";
import { LoginLimiter } from "./ratelimit.ts";

// ---------------------------------------------------------------------------
// Schemas: every body, query string and path id goes through one of these.

const Credentials = z.object({
  email: z.email(),
  password: z.string().min(8, "password must have at least 8 characters"),
});

const TaskBody = z.object({
  title: z.string().trim().min(1).max(100),
  status: z.enum(STATUSES).default("todo"),
  priority: z.enum(PRIORITIES).default("medium"),
  // My own field. A real calendar date is checked by z.iso.date().
  dueDate: z.iso.date().nullable().default(null),
});

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(STATUSES).optional(),
});

const TaskId = z.coerce.number().int().positive();

// ---------------------------------------------------------------------------
// One error shape for every failure: { error, issues }.

type Issue = { path: PropertyKey[]; message: string };

function fail(
  c: Context,
  status: 400 | 401 | 404 | 409 | 429 | 500,
  error: string,
  issues: Issue[] = [],
) {
  return c.json({ error, issues }, status);
}

function invalid(c: Context, error: z.ZodError) {
  const issues = error.issues.map((i) => ({ path: i.path, message: i.message }));
  return fail(c, 400, "validation failed", issues);
}

/** Read a JSON body; a missing or broken body becomes undefined, which Zod rejects. */
const readJson = (c: Context): Promise<unknown> => c.req.json().catch(() => undefined);

// ---------------------------------------------------------------------------

/** Build the whole application around a database, so tests can give it their own. */
export function createApp(database: Db, limiter = new LoginLimiter()) {
  const { db } = database;
  const app = new Hono<Env>();

  app.get("/health", (c) => c.json({ ok: true }));

  // ----- Auth ---------------------------------------------------------------

  app.post("/auth/register", async (c) => {
    const parsed = Credentials.safeParse(await readJson(c));
    if (!parsed.success) return invalid(c, parsed.error);
    const email = parsed.data.email.toLowerCase();

    const [existing] = await db.select({ id: users.id }).from(users)
      .where(eq(users.email, email));
    if (existing) return fail(c, 409, "email already registered");

    const [user] = await db.insert(users)
      .values({ email, passwordHash: await hashPassword(parsed.data.password) })
      .returning({ id: users.id, email: users.email, createdAt: users.createdAt });
    return c.json(user, 201);
  });

  app.post("/auth/login", async (c) => {
    const parsed = Credentials.safeParse(await readJson(c));
    if (!parsed.success) return invalid(c, parsed.error);
    const email = parsed.data.email.toLowerCase();

    // Bonus 15: checked BEFORE the password, so a blocked email gets 429 even when the
    // password is right (otherwise the 429 would tell an attacker the guess was correct).
    const wait = limiter.retryAfter(email);
    if (wait > 0) {
      c.header("Retry-After", String(wait));
      return fail(c, 429, "too many failed logins, try again later");
    }

    const [user] = await db.select().from(users).where(eq(users.email, email));
    // The same answer for an unknown email and a wrong password.
    if (!user || !(await checkPassword(parsed.data.password, user.passwordHash))) {
      limiter.recordFailure(email);
      return fail(c, 401, "wrong email or password");
    }
    limiter.reset(email);
    return c.json({ token: await createSession(database, user.id) });
  });

  // ----- Tasks (only for the logged-in owner) ---------------------------------

  app.use("/api/*", requireAuth(database));

  /** The owner condition that every task query includes. */
  const own = (id: number, userId: number) =>
    and(eq(tasks.id, id), eq(tasks.userId, userId));

  app.get("/api/tasks", async (c) => {
    const parsed = ListQuery.safeParse(c.req.query());
    if (!parsed.success) return invalid(c, parsed.error);
    const { page, limit, status } = parsed.data;

    const where = and(
      eq(tasks.userId, c.get("userId")),
      status ? eq(tasks.status, status) : undefined,
    );
    const items = await db.select().from(tasks).where(where)
      .orderBy(asc(tasks.id)).limit(limit).offset((page - 1) * limit);
    const [{ total }] = await db.select({ total: count() }).from(tasks).where(where);
    return c.json({ items, page, limit, total });
  });

  app.post("/api/tasks", async (c) => {
    const parsed = TaskBody.safeParse(await readJson(c));
    if (!parsed.success) return invalid(c, parsed.error);
    const [task] = await db.insert(tasks)
      .values({ ...parsed.data, userId: c.get("userId") })
      .returning();
    return c.json(task, 201);
  });

  app.get("/api/tasks/:id", async (c) => {
    const id = TaskId.safeParse(c.req.param("id"));
    if (!id.success) return fail(c, 404, "task not found");
    const [task] = await db.select().from(tasks).where(own(id.data, c.get("userId")));
    return task ? c.json(task) : fail(c, 404, "task not found");
  });

  app.put("/api/tasks/:id", async (c) => {
    const id = TaskId.safeParse(c.req.param("id"));
    if (!id.success) return fail(c, 404, "task not found");
    const parsed = TaskBody.safeParse(await readJson(c));
    if (!parsed.success) return invalid(c, parsed.error);
    const [task] = await db.update(tasks).set(parsed.data)
      .where(own(id.data, c.get("userId"))).returning();
    return task ? c.json(task) : fail(c, 404, "task not found");
  });

  app.delete("/api/tasks/:id", async (c) => {
    const id = TaskId.safeParse(c.req.param("id"));
    if (!id.success) return fail(c, 404, "task not found");
    const [task] = await db.delete(tasks)
      .where(own(id.data, c.get("userId"))).returning({ id: tasks.id });
    return task ? c.json({ ok: true }) : fail(c, 404, "task not found");
  });

  // ----- Everything else ------------------------------------------------------

  app.notFound((c) => fail(c, 404, "not found"));

  app.onError((err, c) => {
    console.error(err); // the details go to the log, never to the client
    return fail(c, 500, "internal error");
  });

  return app;
}
