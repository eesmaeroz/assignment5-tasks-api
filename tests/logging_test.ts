// Meryem Esma Eröz, 2200005798
// Bonus 10: one JSON log line per request, and a request id.
import { assertEquals, assertMatch } from "@std/assert";
import { freshApp, send } from "./helpers.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.test("every response has an x-request-id header, a new one each time", async () => {
  const app = await freshApp();
  const a = (await app.request("/health")).headers.get("x-request-id") ?? "";
  const b = (await app.request("/nothing-here")).headers.get("x-request-id") ?? "";
  assertMatch(a, UUID);
  assertMatch(b, UUID);
  assertEquals(a === b, false);
});

Deno.test("one JSON line per request, with the same id as the header", async () => {
  const lines: string[] = [];
  const app = await freshApp({ log: (line) => lines.push(line) });
  const res = await app.request("/nothing-here");
  assertEquals(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assertEquals(
    [entry.method, entry.path, entry.status, entry.requestId],
    ["GET", "/nothing-here", 404, res.headers.get("x-request-id")],
  );
  assertEquals(typeof entry.ms, "number");
  assertEquals(Object.keys(entry), [
    "time",
    "requestId",
    "method",
    "path",
    "status",
    "ms",
  ]);
});

Deno.test("no log line contains a password or a token", async () => {
  const lines: string[] = [];
  const app = await freshApp({ log: (line) => lines.push(line) });
  const password = "very-secret-pw-123";
  await send(app, "POST", "/auth/register", { email: "esma@example.com", password });
  const login = await send(app, "POST", "/auth/login", {
    email: "esma@example.com",
    password,
  });
  const { token } = await login.json();
  await send(app, "GET", "/api/tasks?status=done", undefined, token);
  await send(app, "POST", "/auth/login", {
    email: "esma@example.com",
    password: "wrong-pw-456",
  });

  const all = lines.join("\n");
  assertEquals(lines.length, 4);
  for (const secret of [password, token, "wrong-pw-456", "status=done"]) {
    assertEquals(all.includes(secret), false, `"${secret}" is in the log`);
  }
});
