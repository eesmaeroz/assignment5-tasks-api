// Meryem Esma Eröz, 2200005798
// Bonus 13: live updates over a WebSocket, only to the user who owns the task.
import { assertEquals } from "@std/assert";
import { LiveHub } from "../src/live.ts";
import { type App, freshApp, login, makeTask, send } from "./helpers.ts";

Deno.test("/ws with a missing or bad token is 401, before any upgrade", async () => {
  const live = new LiveHub();
  const app = await freshApp({ live });
  const headers = { upgrade: "websocket" };
  for (const query of ["", "?token=", "?token=not-a-jwt"]) {
    const res = await app.request(`/ws${query}`, { headers });
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: "unauthorized", issues: [] });
  }
});

Deno.test("/ws with a good token but no upgrade is 400", async () => {
  const app = await freshApp();
  const token = await login(app, "esma@example.com");
  const res = await app.request(`/ws?token=${token}`);
  assertEquals(res.status, 400);
});

/** Run the app on a free port, so real WebSockets can connect to it. */
function serve(app: App) {
  const server = Deno.serve({ port: 0, onListen: () => {} }, app.fetch);
  return { server, port: server.addr.port };
}

/** Open a socket and collect every message it gets. */
async function connect(port: number, token: string) {
  const socket = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);
  const messages: { type: string; task: { id: number; title?: string } }[] = [];
  socket.onmessage = (e) => messages.push(JSON.parse(e.data));
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  return { socket, messages };
}

const tick = () => new Promise((r) => setTimeout(r, 50));

async function close(socket: WebSocket) {
  const closed = new Promise((r) => socket.addEventListener("close", r));
  socket.close();
  await closed;
}

Deno.test("two tabs of the same user both get every change; another user gets none", async () => {
  const live = new LiveHub();
  const app = await freshApp({ live });
  const esma = await login(app, "esma@example.com");
  const mery = await login(app, "mery@example.com");
  const { server, port } = serve(app);

  const tab1 = await connect(port, esma);
  const tab2 = await connect(port, esma);
  const meryTab = await connect(port, mery);
  await tick(); // let onopen on the server side run
  assertEquals([live.count(1), live.count(2)], [2, 1]);

  const task = await makeTask(app, esma, { title: "Read unit 7" });
  await send(app, "PUT", `/api/tasks/${task.id}`, { title: "Read unit 7 and 8" }, esma);
  await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, esma);
  await send(app, "POST", `/api/tasks/${task.id}/restore`, undefined, esma);
  await tick();

  for (const tab of [tab1, tab2]) {
    assertEquals(tab.messages.map((m) => m.type), [
      "created",
      "updated",
      "deleted",
      "restored",
    ]);
    assertEquals(tab.messages[1].task.title, "Read unit 7 and 8");
    assertEquals(tab.messages[2].task, { id: task.id });
  }
  assertEquals(meryTab.messages, []); // never to everyone

  await close(tab1.socket);
  await close(tab2.socket);
  await close(meryTab.socket);
  await tick();
  assertEquals([live.count(1), live.count(2)], [0, 0]); // removed on close
  await server.shutdown();
});

Deno.test("a failed change (another user's task) sends nothing", async () => {
  const app = await freshApp();
  const esma = await login(app, "esma@example.com");
  const mery = await login(app, "mery@example.com");
  const task = await makeTask(app, esma, { title: "only mine" });
  const { server, port } = serve(app);
  const esmaTab = await connect(port, esma);
  const meryTab = await connect(port, mery);

  const res = await send(app, "PUT", `/api/tasks/${task.id}`, { title: "hacked" }, mery);
  assertEquals(res.status, 404);
  await tick();
  assertEquals([esmaTab.messages, meryTab.messages], [[], []]);

  await close(esmaTab.socket);
  await close(meryTab.socket);
  await server.shutdown();
});
