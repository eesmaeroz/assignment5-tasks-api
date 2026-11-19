// Meryem Esma Eröz, 2200005798
// Bonus 8: /openapi.json and the docs page come from the same Zod schemas as the checks.
import { assertEquals } from "@std/assert";
import { routes } from "../src/openapi.ts";
import { freshApp, login, send } from "./helpers.ts";

type Operation = {
  security?: Record<string, string[]>[];
  responses: Record<string, unknown>;
  parameters?: { name: string; in: string }[];
  requestBody?: unknown;
};
type Doc = {
  openapi: string;
  paths: Record<string, Record<string, Operation>>;
  components: {
    securitySchemes: Record<string, { type: string; scheme: string }>;
    schemas: Record<string, {
      properties: Record<string, { maxLength?: number; enum?: string[] }>;
    }>;
  };
};

async function doc(): Promise<Doc> {
  const app = await freshApp();
  const res = await app.request("/openapi.json");
  assertEquals(res.status, 200);
  return await res.json();
}

Deno.test("/openapi.json lists every route of the app", async () => {
  const d = await doc();
  assertEquals(d.openapi, "3.0.0");
  const listed = Object.entries(d.paths)
    .flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`))
    .sort();
  const defined = Object.values(routes).map((r) => `${r.method.toUpperCase()} ${r.path}`)
    .sort();
  assertEquals(listed, defined);
  assertEquals(listed.length, 16);
});

Deno.test("a Bearer scheme exists, and exactly the /api routes need it", async () => {
  const d = await doc();
  assertEquals(d.components.securitySchemes.Bearer.scheme, "bearer");
  for (const [path, ops] of Object.entries(d.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const protectedRoute = path.startsWith("/api/");
      assertEquals(op.security !== undefined, protectedRoute, `${method} ${path}`);
    }
  }
});

Deno.test("every /api route lists 401, every {id} route 404, every input 400", async () => {
  const d = await doc();
  for (const [path, ops] of Object.entries(d.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const codes = Object.keys(op.responses);
      const name = `${method} ${path}`;
      if (path.startsWith("/api/")) assertEquals(codes.includes("401"), true, name);
      if (path.includes("{id}")) assertEquals(codes.includes("404"), true, name);
      const hasInput = op.requestBody !== undefined ||
        (op.parameters ?? []).some((p) => p.in === "query" && p.name !== "token");
      const isUpload = path.endsWith("/attachment") && method === "post";
      if (hasInput || isUpload) assertEquals(codes.includes("400"), true, name);
      assertEquals(codes.includes("default"), true, name); // 500 / 503
    }
  }
});

Deno.test("the documented TaskBody is the schema that validates", async () => {
  const d = await doc();
  const taskBody = d.components.schemas.TaskBody.properties;
  assertEquals(taskBody.title.maxLength, 100);
  assertEquals(taskBody.status.enum, ["todo", "in-progress", "done"]);

  // ...and the same limit is what the API refuses
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  const res = await send(app, "POST", "/api/tasks", { title: "x".repeat(101) }, token);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).issues[0].path, ["title"]);
});

Deno.test("/docs is the Swagger UI page and loads /openapi.json", async () => {
  const app = await freshApp();
  const res = await app.request("/docs");
  assertEquals(res.status, 200);
  const html = await res.text();
  assertEquals(html.includes("swagger-ui"), true);
  assertEquals(html.includes("/openapi.json"), true);
});

Deno.test("a body that is not JSON is 400, another content-type is 415", async () => {
  const app = await freshApp();
  const broken = await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"email": "esma@example.com",',
  });
  assertEquals(broken.status, 400);
  assertEquals((await broken.json()).error, "validation failed");

  const text = await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "esma@example.com",
  });
  assertEquals(text.status, 415);
  assertEquals(await text.json(), {
    error: "send the body as application/json",
    issues: [],
  });
});
