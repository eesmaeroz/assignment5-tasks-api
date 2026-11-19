// Meryem Esma Eröz, 2200005798
// Bonus 8: every route described once. The same Zod schemas validate the requests
// (through @hono/zod-openapi) and produce /openapi.json.
import { createRoute, z } from "@hono/zod-openapi";
import { PRIORITIES, STATUSES } from "./schema.ts";

// ----- Schemas: the request side (these are the validators) --------------------

export const Credentials = z.object({
  email: z.email().openapi({ example: "esma@example.com" }),
  password: z.string().min(8, "password must have at least 8 characters")
    .openapi({ example: "kediler123" }),
}).openapi("Credentials");

export const TaskBody = z.object({
  title: z.string().trim().min(1).max(100).openapi({
    example: "Read Meteoroloji unit 7",
  }),
  status: z.enum(STATUSES).default("todo"),
  priority: z.enum(PRIORITIES).default("medium"),
  // My own field. A real calendar date is checked by z.iso.date().
  dueDate: z.iso.date().nullable().default(null).openapi({ example: "2026-11-30" }),
}).openapi("TaskBody");

export const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(STATUSES).optional(),
});

/** The {id} in a task path. Not a positive whole number = no such task (404, not 400). */
export const TaskIdParam = z.object({
  id: z.coerce.number().int().positive()
    .openapi({ param: { name: "id", in: "path" }, example: 1 }),
});

/** For the WebSocket: the token comes in the query (a browser cannot set headers there). */
export const WsQuery = z.object({
  token: z.string().optional().openapi({ description: "the JWT from POST /auth/login" }),
});

// ----- Schemas: the response side ---------------------------------------------

export const ErrorSchema = z.object({
  error: z.string(),
  issues: z.array(z.object({
    path: z.array(z.union([z.string(), z.number()])),
    message: z.string(),
  })),
  requestId: z.string().optional()
    .openapi({ description: "only on 404 and 500, to find the request in the log" }),
}).openapi("Error");

export const TaskSchema = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  title: z.string(),
  status: z.enum(STATUSES),
  priority: z.enum(PRIORITIES),
  dueDate: z.string().nullable(),
  createdAt: z.number().int().openapi({ description: "seconds since 1970" }),
  deletedAt: z.number().int().nullable(),
  doneAt: z.number().int().nullable(),
  attachment: z.string().nullable(),
}).openapi("Task");

const UserSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  role: z.enum(["user", "admin"]),
  createdAt: z.number().int(),
}).openapi("User");

const TokenSchema = z.object({ token: z.string() }).openapi("Token");
const OkSchema = z.object({ ok: z.boolean() });

const TaskPage = z.object({
  items: z.array(TaskSchema),
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
}).openapi("TaskPage");

const Summary = z.object({
  todo: z.number().int(),
  "in-progress": z.number().int(),
  done: z.number().int(),
  total: z.number().int(),
}).openapi("Summary");

const AdminUsers = z.object({
  items: z.array(UserSchema.extend({ tasks: z.number().int() })),
}).openapi("AdminUsers");

// ----- Helpers -------------------------------------------------------------------

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const err = (description: string) => json(ErrorSchema, description);
const body = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
  // required: without it a request with another content-type would skip the validator
  required: true,
});

/** Can happen on every route: 500, or 503 when every pooled client is busy (Bonus 6). */
const unexpected = {
  default: err("500 internal error, or 503 when the database is busy"),
};
/** The task routes need the token from POST /auth/login. */
const bearer = [{ Bearer: [] }];
const notMine = err("no such task, it is deleted, or it belongs to another user");

// ----- Routes ---------------------------------------------------------------------

export const routes = {
  health: createRoute({
    method: "get",
    path: "/health",
    tags: ["health"],
    responses: { 200: json(OkSchema, "the API answers"), ...unexpected },
  }),
  healthz: createRoute({
    method: "get",
    path: "/healthz",
    tags: ["health"],
    summary: "Liveness: the process answers (no database)",
    responses: { 200: json(OkSchema, "alive"), ...unexpected },
  }),
  readyz: createRoute({
    method: "get",
    path: "/readyz",
    tags: ["health"],
    summary: "Readiness: the database answers a query",
    responses: {
      200: json(z.object({ ready: z.boolean() }), "ready"),
      503: err("database not reachable"),
      ...unexpected,
    },
  }),

  register: createRoute({
    method: "post",
    path: "/auth/register",
    tags: ["auth"],
    request: { body: body(Credentials) },
    responses: {
      201: json(UserSchema, "created, with a welcome task"),
      400: err("not an email, or a password under 8 characters"),
      409: err("email already registered"),
      ...unexpected,
    },
  }),
  login: createRoute({
    method: "post",
    path: "/auth/login",
    tags: ["auth"],
    summary: "Get a JWT (one hour); paste it into Authorize",
    request: { body: body(Credentials) },
    responses: {
      200: json(TokenSchema, "the token"),
      400: err("bad body"),
      401: err("wrong email or password"),
      429: err("5 failed logins in a minute (Retry-After header)"),
      ...unexpected,
    },
  }),

  ws: createRoute({
    method: "get",
    path: "/ws",
    tags: ["live"],
    summary: "WebSocket: { type, task } for every change of my tasks",
    request: { query: WsQuery },
    responses: {
      101: { description: "switching to the WebSocket protocol" },
      400: err("not a WebSocket upgrade request"),
      401: err("missing or bad token"),
      ...unexpected,
    },
  }),

  adminUsers: createRoute({
    method: "get",
    path: "/api/admin/users",
    tags: ["admin"],
    security: bearer,
    responses: {
      200: json(AdminUsers, "every user with the number of tasks"),
      401: err("no or bad token"),
      403: err("not an admin"),
      ...unexpected,
    },
  }),
  summary: createRoute({
    method: "get",
    path: "/api/me/summary",
    tags: ["tasks"],
    security: bearer,
    responses: {
      200: json(Summary, "my tasks per status"),
      401: err("no or bad token"),
      ...unexpected,
    },
  }),

  listTasks: createRoute({
    method: "get",
    path: "/api/tasks",
    tags: ["tasks"],
    security: bearer,
    request: { query: ListQuery },
    responses: {
      200: json(TaskPage, "one page of my tasks"),
      400: err("bad page, limit or status"),
      401: err("no or bad token"),
      ...unexpected,
    },
  }),
  createTask: createRoute({
    method: "post",
    path: "/api/tasks",
    tags: ["tasks"],
    security: bearer,
    request: { body: body(TaskBody) },
    responses: {
      201: json(TaskSchema, "created"),
      400: err("bad body"),
      401: err("no or bad token"),
      ...unexpected,
    },
  }),
  getTask: createRoute({
    method: "get",
    path: "/api/tasks/{id}",
    tags: ["tasks"],
    security: bearer,
    request: { params: TaskIdParam },
    responses: {
      200: json(TaskSchema, "the task (x-cache: hit or miss)"),
      401: err("no or bad token"),
      404: notMine,
      ...unexpected,
    },
  }),
  updateTask: createRoute({
    method: "put",
    path: "/api/tasks/{id}",
    tags: ["tasks"],
    security: bearer,
    summary: "Replace a task (fields not sent get their default)",
    request: { params: TaskIdParam, body: body(TaskBody) },
    responses: {
      200: json(TaskSchema, "updated"),
      400: err("bad body"),
      401: err("no or bad token"),
      404: notMine,
      ...unexpected,
    },
  }),
  deleteTask: createRoute({
    method: "delete",
    path: "/api/tasks/{id}",
    tags: ["tasks"],
    security: bearer,
    summary: "Soft delete (can be restored)",
    request: { params: TaskIdParam },
    responses: {
      200: json(OkSchema, "deleted"),
      401: err("no or bad token"),
      404: notMine,
      ...unexpected,
    },
  }),
  restoreTask: createRoute({
    method: "post",
    path: "/api/tasks/{id}/restore",
    tags: ["tasks"],
    security: bearer,
    request: { params: TaskIdParam },
    responses: {
      200: json(TaskSchema, "restored"),
      401: err("no or bad token"),
      404: err("no deleted task of mine with this id"),
      ...unexpected,
    },
  }),

  uploadAttachment: createRoute({
    method: "post",
    path: "/api/tasks/{id}/attachment",
    tags: ["attachments"],
    security: bearer,
    summary: "Attach a PNG or JPEG (at most 1 MB), as the form field file",
    request: {
      params: TaskIdParam,
      body: {
        content: {
          "multipart/form-data": {
            // only for the docs page (a file picker); the route checks the file itself
            schema: z.object({
              file: z.any().optional().openapi({ type: "string", format: "binary" }),
            }),
          },
        },
      },
    },
    responses: {
      201: json(TaskSchema, "attached"),
      400: err("no file in the form field file"),
      401: err("no or bad token"),
      404: notMine,
      413: err("larger than 1 MB"),
      415: err("not a real PNG or JPEG"),
      ...unexpected,
    },
  }),
  getAttachment: createRoute({
    method: "get",
    path: "/api/tasks/{id}/attachment",
    tags: ["attachments"],
    security: bearer,
    request: { params: TaskIdParam },
    responses: {
      200: {
        description: "the image",
        content: {
          "image/png": { schema: { type: "string", format: "binary" } },
          "image/jpeg": { schema: { type: "string", format: "binary" } },
        },
      },
      401: err("no or bad token"),
      404: err("no such task, or it has no image"),
      ...unexpected,
    },
  }),
};
