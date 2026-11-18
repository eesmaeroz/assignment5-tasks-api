// Meryem Esma Eröz, 2200005798
import { type Context, Hono } from "hono";
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db.ts";
import { PRIORITIES, STATUSES, type Task, tasks, users } from "./schema.ts";
import {
  checkPassword,
  createSession,
  type Env,
  hashPassword,
  requireAuth,
  requireRole,
} from "./auth.ts";
import { LoginLimiter } from "./ratelimit.ts";
import { summaryGrouped } from "./summary.ts";

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
  c: Context<Env>,
  status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503,
  error: string,
  issues: Issue[] = [],
) {
  // Bonus 10: a 404 or a 500 also names the request, so a user can report the id and it
  // can be found in the log.
  if (status === 404 || status === 500) {
    return c.json({ error, issues, requestId: c.get("requestId") }, status);
  }
  return c.json({ error, issues }, status);
}

function invalid(c: Context<Env>, error: z.ZodError) {
  const issues = error.issues.map((i) => ({ path: i.path, message: i.message }));
  return fail(c, 400, "validation failed", issues);
}

/** Read a JSON body; a missing or broken body becomes undefined, which Zod rejects. */
const readJson = (c: Context<Env>): Promise<unknown> =>
  c.req.json().catch(() => undefined);

// ---------------------------------------------------------------------------

/** The first task every new user gets (Bonus 2). A test can replace it. */
export type WelcomeTask = (userId: number) => Pick<Task, "userId" | "title" | "priority">;

const defaultWelcome: WelcomeTask = (userId) => ({
  userId,
  title: "Welcome! Add your first task",
  priority: "low",
});

export type AppOptions = {
  limiter?: LoginLimiter;
  welcomeTask?: WelcomeTask;
  /** Bonus 9: whoever registers with this email becomes an admin. */
  adminEmail?: string;
  /** Bonus 10: where the one-line JSON request logs go (default: console.log). */
  log?: (line: string) => void;
};

/** Build the whole application around a database, so tests can give it their own. */
export function createApp(database: Db, options: AppOptions = {}) {
  const { db } = database;
  const limiter = options.limiter ?? new LoginLimiter();
  const welcomeTask = options.welcomeTask ?? defaultWelcome;
  const adminEmail = options.adminEmail?.toLowerCase();
  const log = options.log ?? ((line: string) => console.log(line));
  const app = new Hono<Env>();

  // Bonus 10: the first middleware. It gives every request an id, runs the rest, then
  // writes ONE JSON line. Only these fields are logged: never a body, a header or a query
  // string, so a password or a token cannot end up in the log.
  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    const start = performance.now();
    await next();
    c.header("x-request-id", requestId);
    log(JSON.stringify({
      time: new Date().toISOString(),
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
    }));
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // Bonus 11: liveness and readiness for a platform (Docker, Kubernetes, a load balancer).
  // /healthz: the process is up and answers. It never touches the database.
  app.get("/healthz", (c) => c.json({ ok: true }));
  // /readyz: the process can do real work, so the database must answer a query.
  app.get("/readyz", async (c) => {
    try {
      await db.run(sql`SELECT 1`);
      return c.json({ ready: true });
    } catch (error) {
      console.error("readyz:", error);
      return fail(c, 503, "database not reachable");
    }
  });

  // ----- Auth ---------------------------------------------------------------

  app.post("/auth/register", async (c) => {
    const parsed = Credentials.safeParse(await readJson(c));
    if (!parsed.success) return invalid(c, parsed.error);
    const email = parsed.data.email.toLowerCase();

    const [existing] = await db.select({ id: users.id }).from(users)
      .where(eq(users.email, email));
    if (existing) return fail(c, 409, "email already registered");

    const passwordHash = await hashPassword(parsed.data.password);
    // Bonus 2: the user and the welcome task are created in ONE transaction. If the second
    // insert fails, the first one is rolled back, so there is never a user without it.
    const user = await db.transaction(async (tx) => {
      const role = email === adminEmail ? "admin" : "user";
      const [created] = await tx.insert(users)
        .values({ email, passwordHash, role })
        .returning({
          id: users.id,
          email: users.email,
          role: users.role,
          createdAt: users.createdAt,
        });
      await tx.insert(tasks).values(welcomeTask(created.id));
      return created;
    });
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

  /** The owner condition that every task query includes; deleted tasks are hidden. */
  const own = (id: number, userId: number) =>
    and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt));

  // Bonus 9: admins only. requireAuth (above, for /api/*) has set the role.
  app.use("/api/admin/*", requireRole("admin"));

  // Every user with the number of their (not deleted) tasks: one LEFT JOIN + GROUP BY, so
  // a user with no tasks is listed too, with 0.
  app.get("/api/admin/users", async (c) => {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        tasks: count(tasks.id),
      })
      .from(users)
      .leftJoin(tasks, and(eq(tasks.userId, users.id), isNull(tasks.deletedAt)))
      .groupBy(users.id)
      .orderBy(asc(users.id));
    return c.json({ items: rows });
  });

  // Bonus 3: the number of my tasks per status, with ONE GROUP BY query.
  app.get("/api/me/summary", async (c) => {
    return c.json(await summaryGrouped(database, c.get("userId")));
  });

  app.get("/api/tasks", async (c) => {
    const parsed = ListQuery.safeParse(c.req.query());
    if (!parsed.success) return invalid(c, parsed.error);
    const { page, limit, status } = parsed.data;

    const where = and(
      eq(tasks.userId, c.get("userId")),
      isNull(tasks.deletedAt),
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
    // Bonus 2: soft delete. The row stays; it only gets a deleted_at time.
    const [task] = await db.update(tasks)
      .set({ deletedAt: sql`(strftime('%s','now'))` })
      .where(own(id.data, c.get("userId"))).returning({ id: tasks.id });
    return task ? c.json({ ok: true }) : fail(c, 404, "task not found");
  });

  app.post("/api/tasks/:id/restore", async (c) => {
    const id = TaskId.safeParse(c.req.param("id"));
    if (!id.success) return fail(c, 404, "deleted task not found");
    // Only a task of this user that IS deleted can be restored.
    const [task] = await db.update(tasks)
      .set({ deletedAt: null })
      .where(and(
        eq(tasks.id, id.data),
        eq(tasks.userId, c.get("userId")),
        isNotNull(tasks.deletedAt),
      ))
      .returning();
    return task ? c.json(task) : fail(c, 404, "deleted task not found");
  });

  // ----- Everything else ------------------------------------------------------

  app.notFound((c) => fail(c, 404, "not found"));

  app.onError((err, c) => {
    console.error(err); // the details go to the log, never to the client
    return fail(c, 500, "internal error");
  });

  return app;
}
