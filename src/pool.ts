// Meryem Esma Eröz, 2200005798
// Bonus 6 (option B): a pool of my own.

/** Thrown when no item became free in time. The app answers 503 for it. */
export class PoolTimeoutError extends Error {}

export type PoolOptions<T> = {
  /** How long acquire() waits for a free item before it gives up (0 = for ever). */
  timeoutMs?: number;
  /** Runs every time an item is lent out (the database pool sets busy_timeout here). */
  onAcquire?: (item: T) => Promise<void>;
};

type Waiter<T> = { resolve: (item: T) => void; timer?: ReturnType<typeof setTimeout> };

/**
 * A fixed set of items (here: database clients). acquire() gives an idle one or waits in
 * a queue (first come, first served); release() hands it straight to the next waiter.
 */
export class Pool<T> {
  #idle: T[];
  #waiting: Waiter<T>[] = [];
  readonly size: number;
  #timeoutMs: number;
  #onAcquire?: (item: T) => Promise<void>;

  constructor(items: T[], options: PoolOptions<T> = {}) {
    if (items.length === 0) throw new Error("a pool needs at least one item");
    this.#idle = [...items];
    this.size = items.length;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#onAcquire = options.onAcquire;
  }

  /** How many items are lent out at this moment, and how many callers wait. */
  get inUse(): number {
    return this.size - this.#idle.length;
  }
  get waiting(): number {
    return this.#waiting.length;
  }

  acquire(): Promise<T> {
    // length, not `if (item)`: an item could be 0 or "" in another pool
    if (this.#idle.length > 0) return Promise.resolve(this.#idle.pop() as T);
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter<T> = { resolve };
      if (this.#timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          this.#waiting = this.#waiting.filter((w) => w !== waiter);
          reject(new PoolTimeoutError(`no free item within ${this.#timeoutMs} ms`));
        }, this.#timeoutMs);
      }
      this.#waiting.push(waiter);
    });
  }

  release(item: T): void {
    const next = this.#waiting.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(item); // straight to the next waiter, it never becomes idle
    } else {
      this.#idle.push(item);
    }
  }

  /** Borrow an item for fn and ALWAYS give it back, also when fn throws. */
  async use<R>(fn: (item: T) => Promise<R>): Promise<R> {
    const item = await this.acquire();
    try {
      await this.#onAcquire?.(item);
      return await fn(item);
    } finally {
      this.release(item);
    }
  }
}
