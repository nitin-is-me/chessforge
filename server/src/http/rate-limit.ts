/**
 * Small in-process rate limiter. A single Node process serves the whole app,
 * so an in-memory sliding window is sufficient and avoids a Redis dependency.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 20_000,
  ) {}

  /** Returns true when the action is allowed. */
  take(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const existing = this.hits.get(key);
    if (!existing) {
      this.hits.set(key, [now]);
      this.prune(now);
      return true;
    }
    while (existing.length > 0 && existing[0]! <= cutoff) existing.shift();
    if (existing.length >= this.limit) return false;
    existing.push(now);
    return true;
  }

  /** Milliseconds until the key may act again. */
  retryAfterMs(key: string, now = Date.now()): number {
    const existing = this.hits.get(key);
    if (!existing || existing.length === 0) return 0;
    const cutoff = now - this.windowMs;
    const valid = existing.filter((t) => t > cutoff);
    if (valid.length < this.limit) return 0;
    return Math.max(0, valid[0]! + this.windowMs - now);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number): void {
    if (this.hits.size <= this.maxKeys) return;
    const cutoff = now - this.windowMs;
    for (const [key, times] of this.hits) {
      if (times.length === 0 || times[times.length - 1]! <= cutoff) this.hits.delete(key);
    }
    // Still too large: drop oldest insertions.
    while (this.hits.size > this.maxKeys) {
      const first = this.hits.keys().next();
      if (first.done) break;
      this.hits.delete(first.value);
    }
  }
}
