// Meryem Esma Eröz, 2200005798
// Bonus 12: attach an image to a task and download it again.
import { assertEquals } from "@std/assert";
import { type App, freshApp, login, makeTask, send } from "./helpers.ts";

/** A tiny "image": the real PNG / JPEG signature and then some bytes. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8]);

/** An app that saves into its own empty temporary folder. */
async function uploadApp() {
  const dir = await Deno.makeTempDir();
  const app = await freshApp({ uploadDir: dir });
  const token = await login(app, "esma@example.com");
  const task = await makeTask(app, token, { title: "Lab photo" });
  return { app, dir, token, task };
}

function upload(app: App, id: number, token: string, file?: File | string) {
  const form = new FormData();
  if (file !== undefined) form.append("file", file);
  return app.request(`/api/tasks/${id}/attachment`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

const download = (app: App, id: number, token: string) =>
  app.request(`/api/tasks/${id}/attachment`, {
    headers: { authorization: `Bearer ${token}` },
  });

async function filesIn(dir: string) {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) names.push(entry.name);
  return names;
}

Deno.test("upload and download: the same bytes with the right content-type", async () => {
  const { app, dir, token, task } = await uploadApp();
  const res = await upload(
    app,
    task.id,
    token,
    new File([PNG], "a.png", { type: "image/png" }),
  );
  assertEquals(res.status, 201);
  const updated = await res.json();

  // saved under a generated name, not under "a.png"
  const [saved] = await filesIn(dir);
  assertEquals(updated.attachment, saved);
  assertEquals(/^[0-9a-f-]{36}\.png$/.test(saved), true);

  const got = await download(app, task.id, token);
  assertEquals(got.status, 200);
  assertEquals(got.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await got.arrayBuffer()), PNG);
});

Deno.test("a JPEG works too and is saved as .jpg", async () => {
  const { app, token, task } = await uploadApp();
  const file = new File([JPEG], "photo.jpeg", { type: "image/jpeg" });
  assertEquals((await upload(app, task.id, token, file)).status, 201);
  const got = await download(app, task.id, token);
  assertEquals(got.headers.get("content-type"), "image/jpeg");
  assertEquals(new Uint8Array(await got.arrayBuffer()), JPEG);
});

Deno.test("no file is 400", async () => {
  const { app, dir, token, task } = await uploadApp();
  const none = await upload(app, task.id, token); // empty form
  assertEquals(none.status, 400);
  assertEquals((await none.json()).error, "file required");
  // a text field called "file" is not a file either
  assertEquals((await upload(app, task.id, token, "not a file")).status, 400);
  assertEquals(await filesIn(dir), []);
});

Deno.test("a file over 1 MB is 413", async () => {
  const { app, dir, token, task } = await uploadApp();
  const big = new Uint8Array(1_000_001);
  big.set(PNG);
  const res = await upload(
    app,
    task.id,
    token,
    new File([big], "big.png", { type: "image/png" }),
  );
  assertEquals(res.status, 413);
  // a much bigger body is stopped by bodyLimit before parseBody reads it
  const huge = new Uint8Array(3_000_000);
  huge.set(PNG);
  const res2 = await upload(
    app,
    task.id,
    token,
    new File([huge], "h.png", { type: "image/png" }),
  );
  assertEquals(res2.status, 413);
  assertEquals((await res2.json()).error, "file too large (at most 1 MB)");
  assertEquals(await filesIn(dir), []);
});

Deno.test("another type is 415, and so is a text file that claims to be a PNG", async () => {
  const { app, dir, token, task } = await uploadApp();
  const text = new File(["hello"], "notes.txt", { type: "text/plain" });
  assertEquals((await upload(app, task.id, token, text)).status, 415);
  const fake = new File(["hello"], "fake.png", { type: "image/png" });
  const res = await upload(app, task.id, token, fake);
  assertEquals(res.status, 415);
  assertEquals((await res.json()).error, "the file is not really image/png");
  assertEquals(await filesIn(dir), []);
});

Deno.test("only the owner can upload or download", async () => {
  const { app, dir, token, task } = await uploadApp();
  const png = () => new File([PNG], "a.png", { type: "image/png" });
  await upload(app, task.id, token, png());
  const mery = await login(app, "mery@example.com");

  assertEquals((await download(app, task.id, mery)).status, 404);
  assertEquals((await upload(app, task.id, mery, png())).status, 404);
  assertEquals((await filesIn(dir)).length, 1); // nothing saved for Mery
});

Deno.test("a new image replaces the old file; no image is 404", async () => {
  const { app, dir, token, task } = await uploadApp();
  assertEquals((await download(app, task.id, token)).status, 404);

  await upload(app, task.id, token, new File([PNG], "a.png", { type: "image/png" }));
  await upload(app, task.id, token, new File([JPEG], "b.jpg", { type: "image/jpeg" }));
  const files = await filesIn(dir);
  assertEquals(files.length, 1);
  assertEquals(files[0].endsWith(".jpg"), true);
});

Deno.test("a deleted task has no attachment to download", async () => {
  const { app, token, task } = await uploadApp();
  await upload(app, task.id, token, new File([PNG], "a.png", { type: "image/png" }));
  await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, token);
  assertEquals((await download(app, task.id, token)).status, 404);
});
