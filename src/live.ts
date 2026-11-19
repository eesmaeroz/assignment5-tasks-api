// Meryem Esma Eröz, 2200005798
// Bonus 13: live updates. Every open WebSocket belongs to one user.
import type { Task } from "./schema.ts";

export type LiveEvent =
  | { type: "created" | "updated" | "restored"; task: Task }
  | { type: "deleted"; task: { id: number } };

/** user id -> the open sockets of that user (one per browser tab). */
export class LiveHub {
  #sockets = new Map<number, Set<WebSocket>>();

  add(userId: number, socket: WebSocket): void {
    const set = this.#sockets.get(userId) ?? new Set<WebSocket>();
    set.add(socket);
    this.#sockets.set(userId, set);
  }

  remove(userId: number, socket: WebSocket): void {
    const set = this.#sockets.get(userId);
    if (!set) return;
    set.delete(socket);
    // no empty sets left behind for users who closed every tab
    if (set.size === 0) this.#sockets.delete(userId);
  }

  /** How many tabs of this user are connected (for the tests). */
  count(userId: number): number {
    return this.#sockets.get(userId)?.size ?? 0;
  }

  /** Send one event to this user's sockets only, never to anybody else. */
  send(userId: number, event: LiveEvent): void {
    const message = JSON.stringify(event);
    for (const socket of this.#sockets.get(userId) ?? []) {
      // a tab that is closing cannot receive any more; its onclose removes it soon
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
  }
}
