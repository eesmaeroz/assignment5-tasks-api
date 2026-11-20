// Meryem Esma Eröz, 2200005798
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { OpenAPIHono, type z } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db, DbPool } from "./db.ts";
import { Pool, PoolTimeoutError } from "./pool.ts";
import { type Task, tasks, users } from "./schema.ts";
import {
  checkPassword,
  type Env,
  hashPassword,
  requireAuth,
  requireRole,
} from "./auth.ts";
import { LoginLimiter } from "./ratelimit.ts";
import { summaryGrouped } from "./summary.ts";
import { signToken, verifyToken } from "./jwt.ts";
import { LiveHub } from "./live.ts";
import type { TaskCache } from "./cache.ts";
import {
  extensionFor,
  looksLike,
  MAX_BYTES,
  newName,
  removeSaved,
  typeOfSaved,
} from "./upload.ts";
import { routes } from "./openapi.ts";

// ---------------------------------------------------------------------------
// One error shape for every failure: { error, issues }.
// (The Zod schemas that validate the requests are in openapi.ts, Bonus 8.)

type Issue = { path: (string | number)[]; message: string };
type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 503;
// deno-lint-ignore no-explicit-any
type AnyContext = Context<Env, any, any>;

function fail<S extends ErrorStatus>(
  c: AnyContext,
  status: S,
  error: string,
  issues: Issue[] = [],
) {
  // Bonus 10: a 404 or a 500 also names the request, so a user can report the id and it
  // can be found in the log.
  const requestId = status === 404 || status === 500 ? c.get("requestId") : undefined;
  return c.json(requestId ? { error, issues, requestId } : { error, issues }, status);
}

function invalid(c: AnyContext, error: z.ZodError) {
  const issues = error.issues.map((i) => ({
    // a path part can be a symbol in Zod; JSON has only strings and numbers
    path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
    message: i.message,
  }));
  return fail(c, 400, "validation failed", issues);
}

type ValidationResult = { target: string; success: boolean; error?: z.ZodError };

/**
 * Bonus 8: what a failed validation answers. A bad body or query is 400 with the issues;
 * a bad {id} in the path (like /api/tasks/abc) is 404, the same as an id that is not mine.
 */
const onInvalid =
  (notFound = "not found") => (result: ValidationResult, c: AnyContext) => {
    if (result.success) return;
    if (result.target === "param") return fail(c, 404, notFound);
    return invalid(c, result.error as z.ZodError);
  };

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
  /** Bonus 13: the open WebSockets; a test can pass its own to look inside. */
  live?: LiveHub;
  /**
   * Bonus 6: the routes borrow a client from this pool. Without one, the app uses a pool
   * of one: the database it was given (the tests mostly do that).
   */
  pool?: DbPool;
};

/** Build the whole application around a database, so tests can give it their own. */
export function createApp(database: Db, options: AppOptions = {}) {
  const pool = options.pool ?? new Pool([database]);
  /** Every route runs its queries on a borrowed client and gives it back (Bonus 6). */
  const withDb = <R>(fn: (db: Db["db"]) => Promise<R>) => pool.use((d) => fn(d.db));
  const limiter = options.limiter ?? new LoginLimiter();
  const welcomeTask = options.welcomeTask ?? defaultWelcome;
  const adminEmail = options.adminEmail?.toLowerCase();
  const log = options.log ?? ((line: string) => console.log(line));
  const jwtSecret = options.jwtSecret ?? "change-me";
  const cache = options.cache;
  const uploadDir = options.uploadDir ?? "./uploads";
  const live = options.live ?? new LiveHub();
  const app = new OpenAPIHono<Env>({ defaultHook: onInvalid() });

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

  app.openapi(routes.health, (c) => c.json({ ok: true }, 200));

  // Bonus 11: liveness and readiness for a platform (Docker, Kubernetes, a load balancer).
  // /healthz: the process is up and answers. It never touches the database.
  app.openapi(routes.healthz, (c) => c.json({ ok: true }, 200));
  // /readyz: the process can do real work, so the database must answer a query.
  app.openapi(routes.readyz, async (c) => {
    try {
      await withDb((db) => db.run(sql`SELECT 1`));
      return c.json({ ready: true }, 200);
    } catch (error) {
      console.error("readyz:", error);
      return fail(c, 503, "database not reachable");
    }
  });

  // ----- Bonus 8: the API describes itself -------------------------------------

  app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });
  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "Tasks API",
      version: "1.0.0",
      description:
        "SEN0415 Assignment 5, Meryem Esma Eröz. Log in with POST /auth/login, " +
        "then press Authorize and paste the token.",
    },
  });
  // The docs page: Swagger UI, which loads /openapi.json in the browser.
  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  // ----- Auth ---------------------------------------------------------------

  app.openapi(routes.register, async (c) => {
    const input = c.req.valid("json");
    const email = input.email.toLowerCase();

    const [existing] = await withDb((db) =>
      db.select({ id: users.id }).from(users).where(eq(users.email, email))
    );
    if (existing) return fail(c, 409, "email already registered");

    const passwordHash = await hashPassword(input.password);
    // Bonus 2: the user and the welcome task are created in ONE transaction. If the second
    // insert fails, the first one is rolled back, so there is never a user without it.
    const user = await withDb((db) =>
      db.transaction(async (tx) => {
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
      })
    );
    return c.json(user, 201);
  });

  app.openapi(routes.login, async (c) => {
    const input = c.req.valid("json");
    const email = input.email.toLowerCase();

    // Bonus 15: checked BEFORE the password, so a blocked email gets 429 even when the
    // password is right (otherwise the 429 would tell an attacker the guess was correct).
    const wait = limiter.retryAfter(email);
    if (wait > 0) {
      c.header("Retry-After", String(wait));
      return fail(c, 429, "too many failed logins, try again later");
    }

    const [user] = await withDb((db) =>
      db.select().from(users).where(eq(users.email, email))
    );
    // The same answer for an unknown email and a wrong password.
    if (!user || !(await checkPassword(input.password, user.passwordHash))) {
      limiter.recordFailure(email);
      return fail(c, 401, "wrong email or password");
    }
    limiter.reset(email);
    // Bonus 7: a signed token instead of a session row: nothing is written to the database.
    const token = await signToken({ userId: user.id, role: user.role }, jwtSecret);
    return c.json({ token }, 200);
  });

  // ----- Bonus 13: live updates over a WebSocket --------------------------------

  // A browser cannot send an Authorization header when it opens a WebSocket, so the token
  // comes in the query: /ws?token=... It is checked like requireAuth does, BEFORE the
  // upgrade, so a bad token never gets a socket. (The request log only writes the path,
  // never the query, so the token does not end up in the log.)
  app.openapi(routes.ws, async (c) => {
    const user = await verifyToken(c.req.valid("query").token ?? "", jwtSecret);
    if (user === null) return fail(c, 401, "unauthorized");
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return fail(c, 400, "expected a WebSocket upgrade");
    }
    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
    socket.onopen = () => live.add(user.userId, socket);
    socket.onclose = () => live.remove(user.userId, socket);
    return response;
  });

  // ----- Tasks (only for the logged-in owner) ---------------------------------

  app.use("/api/*", requireAuth(jwtSecret));

  /** The owner condition that every task query includes; deleted tasks are hidden. */
  const own = (id: number, userId: number) =>
    and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt));

  /** The current time in seconds, computed by SQLite (like the created_at default). */
  const NOW = sql`(strftime('%s','now'))`;

  // Bonus 14: done_at is set when a task becomes "done" and cleared when it is not done
  // any more. COALESCE keeps the first time, so saving a done task again (for example to
  // change its title) does not make it "newly done" and push the purge back.
  const doneAtFor = (status: Task["status"]) =>
    status === "done" ? sql`COALESCE(${tasks.doneAt}, strftime('%s','now'))` : null;

  // Bonus 9: admins only. requireAuth (above, for /api/*) has set the role.
  app.use("/api/admin/*", requireRole("admin"));

  // Every user with the number of their (not deleted) tasks: one LEFT JOIN + GROUP BY, so
  // a user with no tasks is listed too, with 0.
  app.openapi(routes.adminUsers, async (c) => {
    const rows = await withDb((db) =>
      db.select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        tasks: count(tasks.id),
      })
        .from(users)
        .leftJoin(tasks, and(eq(tasks.userId, users.id), isNull(tasks.deletedAt)))
        .groupBy(users.id)
        .orderBy(asc(users.id))
    );
    return c.json({ items: rows }, 200);
  });

  // Bonus 3: the number of my tasks per status, with ONE GROUP BY query.
  app.openapi(routes.summary, async (c) => {
    const userId = c.get("userId");
    return c.json(await pool.use((d) => summaryGrouped(d, userId)), 200);
  });

  app.openapi(routes.listTasks, async (c) => {
    const { page, limit, status } = c.req.valid("query");
    const where = and(
      eq(tasks.userId, c.get("userId")),
      isNull(tasks.deletedAt),
      status ? eq(tasks.status, status) : undefined,
    );
    // both queries on the same borrowed client
    const { items, total } = await withDb(async (db) => {
      const items = await db.select().from(tasks).where(where)
        .orderBy(asc(tasks.id)).limit(limit).offset((page - 1) * limit);
      const [{ total }] = await db.select({ total: count() }).from(tasks).where(where);
      return { items, total };
    });
    return c.json({ items, page, limit, total }, 200);
  });

  app.openapi(routes.createTask, async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("userId");
    const [task] = await withDb((db) =>
      db.insert(tasks).values({
        ...input,
        userId,
        doneAt: input.status === "done" ? sql`(strftime('%s','now'))` : null,
      }).returning()
    );
    live.send(task.userId, { type: "created", task });
    return c.json(task, 201);
  });

  app.openapi(routes.getTask, async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("userId");
    // Bonus 16: first the cache. Only a found task is cached, never a 404.
    const cached = await cache?.get(userId, id);
    if (cached) {
      c.header("x-cache", "hit"); // so a curl -i shows where the answer came from
      return c.json(cached, 200);
    }
    const [task] = await withDb((db) => db.select().from(tasks).where(own(id, userId)));
    if (!task) return fail(c, 404, "task not found");
    if (cache) {
      await cache.set(task);
      c.header("x-cache", "miss");
    }
    return c.json(task, 200);
  }, onInvalid("task not found"));

  app.openapi(routes.updateTask, async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const userId = c.get("userId");
    const [task] = await withDb((db) =>
      db.update(tasks)
        .set({ ...input, doneAt: doneAtFor(input.status), updatedAt: NOW })
        .where(own(id, userId)).returning()
    );
    // Bonus 16: the cached copy is old now. Deleted, not replaced: the next GET loads it.
    await cache?.delete(userId, id);
    if (!task) return fail(c, 404, "task not found");
    live.send(task.userId, { type: "updated", task });
    return c.json(task, 200);
  }, onInvalid("task not found"));

  app.openapi(routes.deleteTask, async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("userId");
    // Bonus 2: soft delete. The row stays; it only gets a deleted_at time.
    const [task] = await withDb((db) =>
      db.update(tasks)
        .set({ deletedAt: NOW, updatedAt: NOW })
        .where(own(id, userId)).returning({ id: tasks.id })
    );
    await cache?.delete(userId, id);
    if (!task) return fail(c, 404, "task not found");
    live.send(userId, { type: "deleted", task: { id: task.id } });
    return c.json({ ok: true }, 200);
  }, onInvalid("task not found"));

  app.openapi(routes.restoreTask, async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("userId");
    // Only a task of this user that IS deleted can be restored.
    const [task] = await withDb((db) =>
      db.update(tasks)
        .set({ deletedAt: null, updatedAt: NOW })
        .where(
          and(eq(tasks.id, id), eq(tasks.userId, userId), isNotNull(tasks.deletedAt)),
        )
        .returning()
    );
    await cache?.delete(userId, id);
    if (!task) return fail(c, 404, "deleted task not found");
    live.send(task.userId, { type: "restored", task });
    return c.json(task, 200);
  }, onInvalid("deleted task not found"));

  // ----- Bonus 12: one image per task -------------------------------------------

  // parseBody() reads the whole body into memory, so a huge upload is stopped here, before
  // it is read. 2 MB leaves room for the multipart wrapping around a 1 MB file; the exact
  // 1 MB limit is checked on the file below.
  app.on(
    "POST",
    "/api/tasks/:id/attachment",
    bodyLimit({
      maxSize: 2 * MAX_BYTES,
      onError: (c) => fail(c, 413, "file too large (at most 1 MB)"),
    }),
  );

  app.openapi(routes.uploadAttachment, async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("userId");
    // The owner check comes first: nothing is saved for somebody else's task.
    const [task] = await withDb((db) => db.select().from(tasks).where(own(id, userId)));
    if (!task) return fail(c, 404, "task not found");

    const file = (await c.req.parseBody())["file"];
    if (!(file instanceof File)) {
      return fail(c, 400, "file required", [
        { path: ["file"], message: 'send the image as the form field "file"' },
      ]);
    }
    if (file.size > MAX_BYTES) return fail(c, 413, "file too large (at most 1 MB)");
    if (!extensionFor(file.type)) return fail(c, 415, "only image/png or image/jpeg");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLike(bytes, file.type)) {
      return fail(c, 415, `the file is not really ${file.type}`);
    }

    // Saved under a new name, never under file.name (that could be "../../x" or collide
    // with another upload).
    const name = newName(file.type);
    try {
      await Deno.mkdir(uploadDir, { recursive: true });
      await Deno.writeFile(`${uploadDir}/${name}`, bytes);
    } catch (error) {
      // Bonus 19: Deno Deploy has no disk to keep files on. Say so instead of a 500.
      console.error(`upload: cannot write to ${uploadDir}: ${(error as Error).message}`);
      return fail(c, 503, "file uploads are not available on this server");
    }
    const [updated] = await withDb((db) =>
      db.update(tasks).set({ attachment: name, updatedAt: NOW }).where(own(id, userId))
        .returning()
    );
    // A new image replaces the old one, so the old file is not left behind.
    if (task.attachment) await removeSaved(uploadDir, task.attachment);
    await cache?.delete(userId, id); // Bonus 16: the row changed
    live.send(userId, { type: "updated", task: updated });
    return c.json(updated, 201);
  }, onInvalid("task not found"));

  app.openapi(routes.getAttachment, async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("userId");
    const [task] = await withDb((db) => db.select().from(tasks).where(own(id, userId)));
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
  }, onInvalid("attachment not found"));

  // ----- Everything else ------------------------------------------------------

  app.notFound((c) => fail(c, 404, "not found"));

  app.onError((err, c) => {
    // Bonus 6: every client of the pool stayed busy for 5 s; the caller may try again.
    if (err instanceof PoolTimeoutError) {
      c.header("Retry-After", "1");
      return fail(c, 503, "database busy, try again");
    }
    // Bonus 8: the validators of @hono/zod-openapi throw these two, in our error shape:
    // a body that is not JSON at all (400), and a body with another content-type (415).
    if (err instanceof HTTPException && err.status === 400) {
      return fail(c, 400, "validation failed", [
        { path: [], message: "the body must be valid JSON" },
      ]);
    }
    if (err instanceof HTTPException && err.status === 415) {
      return fail(c, 415, "send the body as application/json");
    }
    console.error(err); // the details go to the log, never to the client
    return fail(c, 500, "internal error");
  });

  return app;
}
