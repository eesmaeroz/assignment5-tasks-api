// Meryem Esma Eröz, 2200005798
// Bonus 13: a small client that logs in and prints every live update it gets.
//   deno task watch demo.esma@example.com demo-password-1
const [email, password] = Deno.args;
if (!email || !password) {
  console.error("usage: deno task watch <email> <password>");
  Deno.exit(1);
}
const base = Deno.env.get("API_URL") ?? "http://localhost:8000";

const res = await fetch(`${base}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!res.ok) {
  console.error(`login failed: ${res.status} ${await res.text()}`);
  Deno.exit(1);
}
const { token } = await res.json();

const socket = new WebSocket(`${base.replace(/^http/, "ws")}/ws?token=${token}`);
socket.onopen = () => console.log(`${email}: connected, waiting for changes`);
socket.onmessage = (e) => {
  const { type, task } = JSON.parse(e.data);
  const title = task.title ? ` "${task.title}" (${task.status})` : "";
  console.log(`${email}: ${type} task ${task.id}${title}`);
};
socket.onclose = (e) => console.log(`${email}: closed (${e.code})`);
