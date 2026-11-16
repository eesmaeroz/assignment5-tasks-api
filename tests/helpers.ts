// Meryem Esma Eröz, 2200005798
import { createApp } from "../src/app.ts";
import { createDb, migrate } from "../src/db.ts";

/**
 * Every test gets a fresh, empty database in its own temporary file.
 * (An in-memory database loses its tables after a transaction with libSQL,
 * so a temporary file is the safe choice.)
 */
export async function freshApp() {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);
  return createApp(db);
}

export type App = Awaited<ReturnType<typeof freshApp>>;

/** Send a JSON request (body optional, token optional). */
export function send(
  app: App,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Register a user and log in; returns the token. */
export async function login(app: App, email: string, password = "kediler123") {
  await send(app, "POST", "/auth/register", { email, password });
  const res = await send(app, "POST", "/auth/login", { email, password });
  const { token } = await res.json();
  return token as string;
}

/** Create a task for the owner of the token and return it. */
export async function makeTask(app: App, token: string, body: Record<string, unknown>) {
  const res = await send(app, "POST", "/api/tasks", body, token);
  return await res.json();
}
