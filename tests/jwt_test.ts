// Meryem Esma Eröz, 2200005798
// Bonus 7: JWT instead of sessions.
import { assertEquals } from "@std/assert";
import { decodeJwt } from "jose";
import { signToken, verifyToken } from "../src/jwt.ts";
import { freshApp, login, send } from "./helpers.ts";

const SECRET = "change-me"; // the development default, the same one freshApp() uses

/** Change one character in the middle of the signature (the third part). */
function tamper(token: string): string {
  const [header, payload, signature] = token.split(".");
  const i = Math.floor(signature.length / 2);
  const swapped = signature[i] === "A" ? "B" : "A";
  return [header, payload, signature.slice(0, i) + swapped + signature.slice(i + 1)].join(
    ".",
  );
}

Deno.test("login returns a JWT with the user id in sub, the role, and one hour to live", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  assertEquals(token.split(".").length, 3); // header.payload.signature
  const claims = decodeJwt(token);
  assertEquals([claims.sub, claims.role], ["1", "user"]);
  assertEquals((claims.exp ?? 0) - (claims.iat ?? 0), 3600);
});

Deno.test("a valid token reaches the route without any session in the database", async () => {
  const app = await freshApp();
  await login(app, "esma@example.com");
  // a token made here, not by /auth/login: it still works, because only the signature counts
  const token = await signToken({ userId: 1, role: "user" }, SECRET);
  assertEquals((await send(app, "GET", "/api/tasks", undefined, token)).status, 200);
});

Deno.test("a tampered token is 401", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  const res = await send(app, "GET", "/api/tasks", undefined, tamper(token));
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, "unauthorized");
});

Deno.test("a changed payload (make me an admin) is 401", async () => {
  const app = await freshApp({ adminEmail: "hoca@example.com" });
  const token = await login(app, "esma@example.com");
  const [header, , signature] = token.split(".");
  const forged = btoa(JSON.stringify({ ...decodeJwt(token), role: "admin" }))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const res = await send(
    app,
    "GET",
    "/api/admin/users",
    undefined,
    `${header}.${forged}.${signature}`,
  );
  assertEquals(res.status, 401);
});

Deno.test("an expired token is 401", async () => {
  const app = await freshApp();
  await login(app, "esma@example.com");
  const expired = await signToken({ userId: 1, role: "user" }, SECRET, "-1s");
  assertEquals((await send(app, "GET", "/api/tasks", undefined, expired)).status, 401);
});

Deno.test("a token signed with another secret is 401", async () => {
  const app = await freshApp();
  await login(app, "esma@example.com");
  const other = await signToken({ userId: 1, role: "user" }, "another-secret-of-mery");
  assertEquals((await send(app, "GET", "/api/tasks", undefined, other)).status, 401);
});

Deno.test("verifyToken: good, tampered, garbage", async () => {
  const token = await signToken({ userId: 7, role: "admin" }, SECRET);
  assertEquals(await verifyToken(token, SECRET), { userId: 7, role: "admin" });
  assertEquals(await verifyToken(tamper(token), SECRET), null);
  assertEquals(await verifyToken("not.a.jwt", SECRET), null);
  assertEquals(await verifyToken("", SECRET), null);
});
