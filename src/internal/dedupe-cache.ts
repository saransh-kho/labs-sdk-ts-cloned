// A minimal "have I seen this key recently" set with a TTL per entry and a
// max size (LRU eviction via Map reinsertion, same trick as AsyncCache) -
// deliberately not built on AsyncCache, which is about async load-on-miss;
// this is a plain throttle/dedupe set, no loader involved.
export class DedupeCache {
  private seen = new Map<string, number>(); // key -> expiresAt

  constructor(
    private maxSize: number,
    private ttlMs: number,
  ) {}

  // Returns true if `key` was already recorded within the TTL window (the
  // caller should suppress whatever action this call represents). Always
  // (re)records the key, refreshing its expiry, regardless of the result.
  shouldThrottle(key: string): boolean {
    const now = Date.now();
    const expiresAt = this.seen.get(key);
    const throttled = expiresAt !== undefined && expiresAt > now;

    this.seen.delete(key); // reinsert so Map order tracks recency (LRU)
    this.seen.set(key, now + this.ttlMs);
    this._evictIfNeeded();

    return throttled;
  }

  size(): number {
    return this.seen.size;
  }

  private _evictIfNeeded(): void {
    while (this.seen.size > this.maxSize) {
      const oldestKey = this.seen.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        break;
      }
      this.seen.delete(oldestKey);
    }
  }
}
