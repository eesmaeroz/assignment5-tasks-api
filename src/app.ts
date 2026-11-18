// Meryem Esma Eröz, 2200005798
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db.ts";
import { PRIORITIES, STATUSES, type Task, tasks, users } from "./schema.ts";
import {
  checkPassword,
  type Env,
  hashPassword,
  requireAuth,
  requireRole,
} from "./auth.ts";
import { LoginLimiter } from "./ratelimit.ts";
import { summaryGrouped } from "./summary.ts";
import { signToken } from "./jwt.ts";
import type { TaskCache } from "./cache.ts";
import {
  extensionFor,
  looksLike,
  MAX_BYTES,
  newName,
  removeSaved,
  typeOfSaved,
} from "./upload.ts";

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
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 503,
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
  /** Bonus 7: the secret that signs the tokens (config.ts checks it in production). */
  jwtSecret?: string;
  /** Bonus 16: cache for GET /api/tasks/:id. Without it every read goes to the database. */
  cache?: TaskCache;
  /** Bonus 12: where attached images are saved (default ./uploads). */
  uploadDir?: string;
};

/** Build the whole application around a database, so tests can give it their own. */
export function createApp(database: Db, options: AppOptions = {}) {
  const { db } = database;
  const limiter = options.limiter ?? new LoginLimiter();
  const welcomeTask = options.welcomeTask ?? defaultWelcome;
  const adminEmail = options.adminEmail?.toLowerCase();
  const log = options.log ?? ((line: string) => console.log(line));
  const jwtSecret = options.jwtSecret ?? "change-me";
  const cache = options.cache;
  const uploadDir = options.uploadDir ?? "./uploads";
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
    // Bonus 7: a signed token instead of a session row: nothing is written to the database.
    return c.json({
      token: await signToken({ userId: user.id, role: user.role }, jwtSecret),
    });
  });

  // ----- Tasks (only for the logged-in owner) ---------------------------------

  app.use("/api/*", requireAuth(jwtSecret));

  /** The owner condition that every task query includes; deleted tasks are hidden. */
  const own = (id: number, userId: number) =>
    and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt));

  // Bonus 14: done_at is set when a task becomes "done" and cleared when it is not done
  // any more. COALESCE keeps the first time, so saving a done task again (for example to
  // change its title) does not make it "newly done" and push the purge back.
  const doneAtFor = (status: Task["status"]) =>
    status === "done" ? sql`COALESCE(${tasks.doneAt}, strftime('%s','now'))` : null;

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
      .values({
        ...parsed.data,
        userId: c.get("userId"),
        doneAt: parsed.data.status === "done" ? sql`(strftime('%s','now'))` : null,
      })
      .returning();
    return c.json(task, 201);
  });

  app.get("/api/tasks/:id", async (c) => {
    const id = TaskId.safeParse(c.req.param("id"));
    if (!id.success) return fail(c, 404, "task not found");
    const userId = c.get("userId");
    // Bonus 16: first the cache. Only a found task is cached, never a 404.
    const cached = await cache?.get(userId, id.data);
    if (cached) {
      c.header("x-cache", "hit"); // so a curl -i shows where the answer came from
      return c.json(cached);
    }
    const [task] = await db.select().from(tasks).where(own(id.data, userId));
    if (!task) return fail(c, 404, "task not found");
    if (cache) {
      await cache.set(task);
      c.header("x-cache", "miss");
    }
    return c.json(task);
  });

  app.put("/api/tasks/:id", async (c) => {
    const id = TaskId.safeParse(c.req.param("id"));
    if (!id.success) return fail(c, 404, "task not found");
    const parsed = TaskBody.safeParse(await readJson(c));
    if (!parsed.success) return invalid(c, parsed.error);
    const [task] = await db.update(tasks)
      .set({ ...parsed.data, doneAt: doneAtFor(parsed.data.status) })
      .where(own(id.data, c.get("userId"))).returning();
    // Bonus 16: the cached copy is old now. Deleted, not replaced: the next GET loads it.
    await cache?.delete(c.get("userId"), id.data);
    return task ? c.json(task) : fail(c, 404, "task not found");
  });

  app.delete("/api/tasks/:id", async (c) => {
    const id = TaskId.safeParse(c.req.param("id"));
    if (!id.success) return fail(c, 404, "task not found");
    // Bonus 2: soft delete. The row stays; it only gets a deleted_at time.
    const [task] = await db.update(tasks)
      .set({ deletedAt: sql`(strftime('%s','now'))` })
      .where(own(id.data, c.get("userId"))).returning({ id: tasks.id });
    await cache?.delete(c.get("userId"), id.data);
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
    await cache?.delete(c.get("userId"), id.data);
    return task ? c.json(task) : fail(c, 404, "deleted task not found");
  });

  // ----- Bonus 12: one image per task -------------------------------------------

  app.post(
    "/api/tasks/:id/attachment",
    // parseBody() reads the whole body into memory, so a huge upload is stopped here,
    // before it is read. 2 MB leaves room for the multipart wrapping around a 1 MB file;
    // the exact 1 MB limit is checked on the file below.
    bodyLimit({
      maxSize: 2 * MAX_BYTES,
      onError: (c) => fail(c as Context<Env>, 413, "file too large (at most 1 MB)"),
    }),
    async (c) => {
      const id = TaskId.safeParse(c.req.param("id"));
      if (!id.success) return fail(c, 404, "task not found");
      const userId = c.get("userId");
      // The owner check comes first: nothing is saved for somebody else's task.
      const [task] = await db.select().from(tasks).where(own(id.data, userId));
      if (!task) return fail(c, 404, "task not found");

      const file = (await c.req.parseBody())["file"];
      if (!(file instanceof File)) {
        return fail(c, 400, "file required", [
          { path: ["file"], message: 'send the image as the form field "file"' },
        ]);
      }
      if (file.size > MAX_BYTES) return fail(c, 413, "file too large (at most 1 MB)");
      if (!extensionFor(file.type)) {
        return fail(c, 415, "only image/png or image/jpeg");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!looksLike(bytes, file.type)) {
        return fail(c, 415, `the file is not really ${file.type}`);
      }

      // Saved under a new name, never under file.name (that could be "../../x" or
      // collide with another upload).
      const name = newName(file.type);
      await Deno.mkdir(uploadDir, { recursive: true });
      await Deno.writeFile(`${uploadDir}/${name}`, bytes);
      const [updated] = await db.update(tasks).set({ attachment: name })
        .where(own(id.data, userId)).returning();
      // A new image replaces the old one, so the old file is not left behind.
      if (task.attachment) await removeSaved(uploadDir, task.attachment);
      await cache?.delete(userId, id.data); // Bonus 16: the row changed
      return c.json(updated, 201);
    },
  );

  app.get("/api/tasks/:id/attachment", async (c) => {
    const id = TaskId.safeParse(c.req.param("id"));
    if (!id.success) return fail(c, 404, "attachment not found");
    const [task] = await db.select().from(tasks).where(own(id.data, c.get("userId")));
    if (!task?.attachment) return fail(c, 404, "attachment not found");
    try {
      const bytes = await Deno.readFile(`${uploadDir}/${task.attachment}`);
      return c.body(bytes, 200, {
        "content-type": typeOfSaved(task.attachment),
        // the browser must not guess another type from the bytes
        "x-content-type-options": "nosniff",
      });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return fail(c, 404, "attachment not found");
      }
      throw error;
    }
  });

  // ----- Everything else ------------------------------------------------------

  app.notFound((c) => fail(c, 404, "not found"));

  app.onError((err, c) => {
    console.error(err); // the details go to the log, never to the client
    return fail(c, 500, "internal error");
  });

  return app;
}
