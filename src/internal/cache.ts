// A generic, read-driven async cache: TTL + stale-while-revalidate + negative
// caching, backed by nothing more than a Map and lazy timestamp comparisons.
//
// Unlike labs-sdk-go's cache (a ticker-driven LRU with a background
// goroutine/worker-pool for refresh) or java-labs-sdk's Caffeine-backed store
// (thread-pool-backed refreshAfterWrite), this cache needs no scheduler, no
// locks, and no concurrency primitives at all: JS is single-threaded, so
// "background refresh" is just an un-awaited Promise, and there is no
// concurrent mutation to guard against between await points.

export type CacheSettings = {
  ttlMs?: number;
  maxSize?: number;
  negativeTtlMs?: number;
  errorTtlMs?: number;
};

export const DefaultCacheSettings: Required<CacheSettings> = {
  ttlMs: 180_000,
  maxSize: 500,
  negativeTtlMs: 15_000,
  errorTtlMs: 5_000,
};

export type Loader<K, V> = (key: K) => Promise<V>;

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;

  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
    // ES5-target transpilation breaks the prototype chain for classes
    // extending built-ins (Error) unless explicitly restored - without this,
    // `instanceof NotFoundError` fails on instances constructed this way.
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export type CacheOp =
  | "load"
  | "hit"
  | "miss"
  | "refresh-start"
  | "refresh-success"
  | "refresh-failure"
  | "negative-hit"
  | "not-found"
  | "load-error"
  | "eviction";

export type CacheTraceEvent = {
  op: CacheOp;
  key: string;
  ageMs?: number;
  error?: unknown;
};

export type CacheTraceSink = (event: CacheTraceEvent) => void;

type Entry<V> =
  | { kind: "value"; value: V; loadedAt: number; refreshing?: Promise<void> }
  | { kind: "negative"; notFoundAt: number }
  | { kind: "error"; erroredAt: number; error: unknown }
  | { kind: "loading"; promise: Promise<V> };

export class AsyncCache<K extends string, V> {
  private cache = new Map<K, Entry<V>>();
  private settings: Required<CacheSettings>;

  constructor(
    settings: CacheSettings,
    private loader: Loader<K, V>,
    private onEvent?: CacheTraceSink,
  ) {
    this.settings = {
      ttlMs: settings.ttlMs ?? DefaultCacheSettings.ttlMs,
      maxSize: settings.maxSize ?? DefaultCacheSettings.maxSize,
      negativeTtlMs: settings.negativeTtlMs ?? DefaultCacheSettings.negativeTtlMs,
      errorTtlMs: settings.errorTtlMs ?? DefaultCacheSettings.errorTtlMs,
    };
  }

  // Pure synchronous read: only a "fresh" or "stale-but-still-serving" value
  // is ever returned. Never triggers a load.
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (entry?.kind === "value") {
      this._touch(key, entry);
      return entry.value;
    }
    return undefined;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  async getOrLoad(key: K): Promise<V> {
    const entry = this.cache.get(key);
    const now = Date.now();

    if (entry?.kind === "value") {
      this._touch(key, entry);
      const ageMs = now - entry.loadedAt;
      if (ageMs >= this.settings.ttlMs && !entry.refreshing) {
        this._emit({ op: "refresh-start", key, ageMs });
        // Stale-while-revalidate: kick off a background refresh but return the
        // stale value immediately. Nothing awaits this promise here.
        entry.refreshing = this._refresh(key);
      } else {
        this._emit({ op: "hit", key, ageMs });
      }
      return entry.value;
    }

    if (entry?.kind === "negative") {
      const ageMs = now - entry.notFoundAt;
      if (ageMs < this.settings.negativeTtlMs) {
        this._emit({ op: "negative-hit", key, ageMs });
        throw new NotFoundError(`not found: ${key}`);
      }
      // Negative TTL expired - fall through and retry the load.
    } else if (entry?.kind === "error") {
      if (now - entry.erroredAt < this.settings.errorTtlMs) {
        throw entry.error;
      }
      // Error TTL expired - fall through and retry the load. This is the
      // cache's only retry/backoff mechanism: there is no separate
      // retry-with-backoff layer, deliberately - a failed load simply can't
      // be retried again until errorTtlMs elapses, which acts as a de facto
      // fixed backoff window. Considered good enough for this SDK's needs;
      // revisit only if a real need for exponential/jittered backoff shows up.
    } else if (entry?.kind === "loading") {
      return entry.promise;
    }

    this._emit({ op: "miss", key });
    return this._load(key);
  }

  set(key: K, value: V): void {
    this._store(key, { kind: "value", value, loadedAt: Date.now() });
  }

  invalidate(key: K): void {
    this.cache.delete(key);
  }

  size(): number {
    return this.cache.size;
  }

  *entries(): IterableIterator<[K, V]> {
    for (const key of Array.from(this.cache.keys())) {
      const entry = this.cache.get(key);
      if (entry?.kind === "value") {
        yield [key, entry.value];
      }
    }
  }

  // No timers to clear - kept for symmetry with what a future ticker-based
  // design (or callers expecting SDK.Stop()-style cleanup) might need.
  stop(): void {
    return;
  }

  private _load(key: K): Promise<V> {
    const promise = this._doLoad(key);
    this.cache.set(key, { kind: "loading", promise });
    return promise;
  }

  private async _doLoad(key: K): Promise<V> {
    this._emit({ op: "load", key });
    try {
      const value = await this.loader(key);
      this._store(key, { kind: "value", value, loadedAt: Date.now() });
      return value;
    } catch (error) {
      if (error instanceof NotFoundError) {
        this.cache.set(key, { kind: "negative", notFoundAt: Date.now() });
        this._emit({ op: "not-found", key, error });
      } else {
        this.cache.set(key, { kind: "error", erroredAt: Date.now(), error });
        this._emit({ op: "load-error", key, error });
      }
      throw error;
    }
  }

  private async _refresh(key: K): Promise<void> {
    try {
      const value = await this.loader(key);
      this._store(key, { kind: "value", value, loadedAt: Date.now() });
      this._emit({ op: "refresh-success", key });
    } catch (error) {
      // Keep serving the old stale value on refresh failure; just clear the
      // in-flight marker so the next stale read tries again.
      const existing = this.cache.get(key);
      if (existing?.kind === "value") {
        existing.refreshing = undefined;
      }
      this._emit({ op: "refresh-failure", key, error });
    }
  }

  private _store(key: K, entry: Entry<V>): void {
    this.cache.delete(key); // reinsert so Map order tracks recency (LRU)
    this.cache.set(key, entry);
    this._evictIfNeeded();
  }

  private _touch(key: K, entry: Entry<V>): void {
    this.cache.delete(key);
    this.cache.set(key, entry);
  }

  private _evictIfNeeded(): void {
    let guard = this.cache.size;
    while (this.cache.size > this.settings.maxSize && guard-- > 0) {
      const oldestKey = this.cache.keys().next().value as K | undefined;
      if (oldestKey === undefined) {
        break;
      }
      const oldest = this.cache.get(oldestKey);
      if (oldest?.kind === "value" && oldest.refreshing) {
        // Never evict an entry mid-refresh; move it to the back and keep scanning.
        this.cache.delete(oldestKey);
        this.cache.set(oldestKey, oldest);
        continue;
      }
      this.cache.delete(oldestKey);
      this._emit({ op: "eviction", key: oldestKey });
    }
  }

  private _emit(event: CacheTraceEvent): void {
    this.onEvent?.(event);
  }
}
