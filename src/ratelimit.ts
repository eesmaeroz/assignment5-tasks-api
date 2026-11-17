// Meryem Esma Eröz, 2200005798
// Bonus 15: limit failed logins per email.

type Entry = { failures: number; resetAt: number };

/**
 * Counts failed logins per key (the email) in a fixed window.
 * After `max` failures inside one window the key is blocked until the window ends.
 * The clock is a parameter, so a test can move time forward without waiting a minute.
 */
export class LoginLimiter {
  #entries = new Map<string, Entry>();

  constructor(
    readonly max = 5,
    readonly windowMs = 60_000,
    readonly now: () => number = Date.now,
  ) {}

  /** Seconds until the key may try again, or 0 when it is not blocked. */
  retryAfter(key: string): number {
    const entry = this.#entries.get(key);
    if (!entry) return 0;
    const left = entry.resetAt - this.now();
    if (left <= 0) {
      this.#entries.delete(key); // the window is over: start again from 0
      return 0;
    }
    return entry.failures >= this.max ? Math.ceil(left / 1000) : 0;
  }

  /** Count one failed login. The first failure opens a new window. */
  recordFailure(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry || entry.resetAt <= this.now()) {
      this.#entries.set(key, { failures: 1, resetAt: this.now() + this.windowMs });
    } else {
      entry.failures++;
    }
  }

  /** A successful login clears the counter. */
  reset(key: string): void {
    this.#entries.delete(key);
  }
}
