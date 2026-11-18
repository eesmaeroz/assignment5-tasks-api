// Meryem Esma Eröz, 2200005798
// Bonus 9: roles (RBAC).
import { assertEquals } from "@std/assert";
import { freshApp, login, makeTask, send } from "./helpers.ts";

const ADMIN = "hoca@example.com";

Deno.test("GET /api/admin/users without a token is 401", async () => {
  const app = await freshApp({ adminEmail: ADMIN });
  const res = await send(app, "GET", "/api/admin/users");
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, "unauthorized");
});

Deno.test("a normal user is 403 on an admin route", async () => {
  const app = await freshApp({ adminEmail: ADMIN });
  const token = await login(app, "esma@example.com");
  const res = await send(app, "GET", "/api/admin/users", undefined, token);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "forbidden", issues: [] });
});

Deno.test("the admin gets every user with their number of tasks", async () => {
  const app = await freshApp({ adminEmail: ADMIN });
  const esma = await login(app, "esma@example.com");
  await makeTask(app, esma, { title: "a" });
  const gone = await makeTask(app, esma, { title: "deleted, not counted" });
  await send(app, "DELETE", `/api/tasks/${gone.id}`, undefined, esma);
  const admin = await login(app, ADMIN);

  const res = await send(app, "GET", "/api/admin/users", undefined, admin);
  assertEquals(res.status, 200);
  const { items } = await res.json();
  assertEquals(
    items.map((
      u: { email: string; role: string; tasks: number },
    ) => [u.email, u.role, u.tasks]),
    [["esma@example.com", "user", 2], [ADMIN, "admin", 1]], // welcome task + "a"; admin: welcome
  );
  assertEquals("passwordHash" in items[0], false);
});

Deno.test("register gives the role: admin only for ADMIN_EMAIL (any letter case)", async () => {
  const app = await freshApp({ adminEmail: ADMIN });
  const user = await send(app, "POST", "/auth/register", {
    email: "esma@example.com",
    password: "kediler123",
  });
  const admin = await send(app, "POST", "/auth/register", {
    email: "HOCA@example.com",
    password: "kediler123",
  });
  assertEquals([(await user.json()).role, (await admin.json()).role], ["user", "admin"]);
});

Deno.test("the body cannot make somebody an admin", async () => {
  const app = await freshApp({ adminEmail: ADMIN });
  const res = await send(app, "POST", "/auth/register", {
    email: "esma@example.com",
    password: "kediler123",
    role: "admin", // not in the Zod schema, so it is dropped
  });
  assertEquals((await res.json()).role, "user");
});

Deno.test("without ADMIN_EMAIL nobody is an admin", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  assertEquals(
    (await send(app, "GET", "/api/admin/users", undefined, token)).status,
    403,
  );
});
