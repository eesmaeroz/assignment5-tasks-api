// Meryem Esma Eröz, 2200005798
import { assert, assertEquals } from "@std/assert";
import { freshApp, send } from "./helpers.ts";

const esma = { email: "esma@example.com", password: "kediler123" };

Deno.test("register answers 201 with id and email, never the hash", async () => {
  const app = await freshApp();
  const res = await send(app, "POST", "/auth/register", esma);
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.email, "esma@example.com");
  assertEquals(typeof body.id, "number");
  assert(!("passwordHash" in body), "the hash must not be returned");
  assert(
    !JSON.stringify(body).includes("kediler123"),
    "the password must not be returned",
  );
});

Deno.test("register with the same email twice is 409", async () => {
  const app = await freshApp();
  await send(app, "POST", "/auth/register", esma);
  // the same email in other letter case is still the same email
  const res = await send(app, "POST", "/auth/register", {
    ...esma,
    email: "ESMA@example.com",
  });
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "email already registered");
});

Deno.test("register with a bad body is 400 and lists the problems", async () => {
  const app = await freshApp();
  const res = await send(app, "POST", "/auth/register", {
    email: "not-an-email",
    password: "short",
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "validation failed");
  const paths = body.issues.map((i: { path: string[] }) => i.path[0]).sort();
  assertEquals(paths, ["email", "password"]);
});

Deno.test("register without any body is 400, not a crash", async () => {
  const app = await freshApp();
  const res = await app.request("/auth/register", { method: "POST" });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "validation failed");
});

Deno.test("login with the right password returns a token", async () => {
  const app = await freshApp();
  await send(app, "POST", "/auth/register", esma);
  const res = await send(app, "POST", "/auth/login", esma);
  assertEquals(res.status, 200);
  const { token } = await res.json();
  assertEquals(typeof token, "string");
  assert(token.length > 20);
});

Deno.test("wrong password and unknown email give the same 401", async () => {
  const app = await freshApp();
  await send(app, "POST", "/auth/register", esma);
  const wrongPassword = await send(app, "POST", "/auth/login", {
    ...esma,
    password: "yanlis-sifre",
  });
  const unknownEmail = await send(app, "POST", "/auth/login", {
    email: "nobody@example.com",
    password: "kediler123",
  });
  assertEquals(wrongPassword.status, 401);
  assertEquals(unknownEmail.status, 401);
  assertEquals(await wrongPassword.json(), await unknownEmail.json());
});
