// Meryem Esma Eröz, 2200005798
// Bonus 15: rate limit on login.
import { assertEquals } from "@std/assert";
import { LoginLimiter } from "../src/ratelimit.ts";
import { freshApp, send } from "./helpers.ts";

const esma = { email: "esma@example.com", password: "kediler123" };
const wrong = { ...esma, password: "yanlis-sifre" };

Deno.test("five failures, then the sixth try is 429 with Retry-After, even with the right password", async () => {
  const app = await freshApp();
  await send(app, "POST", "/auth/register", esma);
  for (let i = 1; i <= 5; i++) {
    const res = await send(app, "POST", "/auth/login", wrong);
    assertEquals(res.status, 401, `failure ${i}`);
  }
  const blocked = await send(app, "POST", "/auth/login", esma);
  assertEquals(blocked.status, 429);
  assertEquals(await blocked.json(), {
    error: "too many failed logins, try again later",
    issues: [],
  });
  const retry = Number(blocked.headers.get("retry-after"));
  assertEquals(retry > 0 && retry <= 60, true, `Retry-After was ${retry}`);
});

Deno.test("the block is per email: another user can still log in", async () => {
  const app = await freshApp();
  await send(app, "POST", "/auth/register", esma);
  await send(app, "POST", "/auth/register", {
    email: "mery@example.com",
    password: "papatya99",
  });
  for (let i = 0; i < 5; i++) await send(app, "POST", "/auth/login", wrong);
  const mery = await send(app, "POST", "/auth/login", {
    email: "mery@example.com",
    password: "papatya99",
  });
  assertEquals(mery.status, 200);
});

Deno.test("the email is counted case-insensitively", async () => {
  const app = await freshApp();
  await send(app, "POST", "/auth/register", esma);
  for (let i = 0; i < 5; i++) {
    await send(app, "POST", "/auth/login", {
      ...wrong,
      email: i % 2 ? "ESMA@example.com" : esma.email,
    });
  }
  const res = await send(app, "POST", "/auth/login", esma);
  assertEquals(res.status, 429);
});

Deno.test("a successful login clears the counter", async () => {
  const app = await freshApp();
  await send(app, "POST", "/auth/register", esma);
  for (let i = 0; i < 4; i++) await send(app, "POST", "/auth/login", wrong);
  assertEquals((await send(app, "POST", "/auth/login", esma)).status, 200);
  for (let i = 0; i < 4; i++) await send(app, "POST", "/auth/login", wrong);
  // 4 + 4 failures, but the success in between started again from 0: not blocked
  assertEquals((await send(app, "POST", "/auth/login", esma)).status, 200);
});

Deno.test("after the window the email may try again (fake clock, no waiting)", async () => {
  let now = 1_000_000;
  const limiter = new LoginLimiter(5, 60_000, () => now);
  const app = await freshApp(limiter);
  await send(app, "POST", "/auth/register", esma);
  for (let i = 0; i < 5; i++) await send(app, "POST", "/auth/login", wrong);

  now += 30_000; // half a minute later: still blocked, 30 seconds left
  const still = await send(app, "POST", "/auth/login", esma);
  assertEquals(still.status, 429);
  assertEquals(still.headers.get("retry-after"), "30");

  now += 30_001; // the minute is over
  assertEquals((await send(app, "POST", "/auth/login", esma)).status, 200);
});

Deno.test("LoginLimiter: an old window starts again from 0", () => {
  let now = 0;
  const limiter = new LoginLimiter(2, 1_000, () => now);
  limiter.recordFailure("a");
  now = 2_000; // the first window is over before the second failure
  limiter.recordFailure("a");
  assertEquals(limiter.retryAfter("a"), 0); // only 1 failure in the new window
  limiter.recordFailure("a");
  assertEquals(limiter.retryAfter("a"), 1); // 2 failures: blocked for the rest (1 s)
});
