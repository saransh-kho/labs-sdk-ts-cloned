import { AsyncCache, CacheTraceEvent, NotFoundError } from "../src/internal/cache";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test("get() is a pure synchronous read that never triggers a load", () => {
  const loader = jest.fn();
  const cache = new AsyncCache<string, string>({ ttlMs: 1000 }, loader);
  expect(cache.get("a")).toBeUndefined();
  expect(cache.has("a")).toBe(false);
  expect(loader).not.toHaveBeenCalled();
});

test("cold load populates the cache and returns the loaded value", async () => {
  const loader = jest.fn(async (key: string) => `value-${key}`);
  const cache = new AsyncCache<string, string>({ ttlMs: 1000 }, loader);

  const value = await cache.getOrLoad("a");
  expect(value).toBe("value-a");
  expect(loader).toHaveBeenCalledTimes(1);
  expect(cache.get("a")).toBe("value-a");
});

test("a read before TTL expiry serves from cache with no additional loader calls", async () => {
  const loader = jest.fn(async (key: string) => `value-${key}`);
  const cache = new AsyncCache<string, string>({ ttlMs: 1000 }, loader);

  await cache.getOrLoad("a");
  jest.advanceTimersByTime(500); // still fresh
  const value = await cache.getOrLoad("a");

  expect(value).toBe("value-a");
  expect(loader).toHaveBeenCalledTimes(1);
});

test("a read past TTL returns the stale value immediately and refreshes in the background", async () => {
  const first = "value-a-1";
  const refreshGate = deferred<string>();
  const loader = jest.fn<Promise<string>, [string]>();
  loader.mockResolvedValueOnce(first);
  loader.mockImplementationOnce(() => refreshGate.promise);

  const cache = new AsyncCache<string, string>({ ttlMs: 1000 }, loader);
  await cache.getOrLoad("a");

  jest.advanceTimersByTime(1000); // now stale
  const staleRead = await cache.getOrLoad("a");
  // Stale-while-revalidate: the caller gets the OLD value back immediately,
  // even though the background refresh hasn't resolved yet.
  expect(staleRead).toBe(first);
  expect(loader).toHaveBeenCalledTimes(2);

  // A concurrent read while the refresh is in flight should not trigger a
  // second refresh call.
  const concurrentRead = await cache.getOrLoad("a");
  expect(concurrentRead).toBe(first);
  expect(loader).toHaveBeenCalledTimes(2);

  refreshGate.resolve("value-a-2");
  await Promise.resolve();
  await Promise.resolve();

  expect(cache.get("a")).toBe("value-a-2");
});

test("refresh failure keeps serving the old stale value and does not throw", async () => {
  const loader = jest.fn<Promise<string>, [string]>();
  loader.mockResolvedValueOnce("good-value");
  loader.mockRejectedValueOnce(new Error("upstream boom"));

  const events: CacheTraceEvent[] = [];
  const cache = new AsyncCache<string, string>({ ttlMs: 1000 }, loader, (e) => events.push(e));

  await cache.getOrLoad("a");
  jest.advanceTimersByTime(1000);

  const value = await cache.getOrLoad("a");
  expect(value).toBe("good-value");

  // let the background refresh's rejection settle
  await Promise.resolve();
  await Promise.resolve();

  expect(cache.get("a")).toBe("good-value");
  expect(events.some((e) => e.op === "refresh-failure")).toBe(true);
});

test("confirmed not-found is negative-cached and does not retry within negativeTtlMs", async () => {
  const loader = jest.fn(async () => {
    throw new NotFoundError("nope");
  });
  const cache = new AsyncCache<string, string>({ ttlMs: 1000, negativeTtlMs: 5000 }, loader);

  await expect(cache.getOrLoad("missing")).rejects.toBeInstanceOf(NotFoundError);
  expect(loader).toHaveBeenCalledTimes(1);

  jest.advanceTimersByTime(1000);
  await expect(cache.getOrLoad("missing")).rejects.toBeInstanceOf(NotFoundError);
  expect(loader).toHaveBeenCalledTimes(1); // still negative-cached, no retry

  jest.advanceTimersByTime(5000);
  await expect(cache.getOrLoad("missing")).rejects.toBeInstanceOf(NotFoundError);
  expect(loader).toHaveBeenCalledTimes(2); // negative TTL expired, retried
});

test("transient errors are cached with their own (shorter) TTL and retried sooner", async () => {
  const loader = jest.fn(async () => {
    throw new Error("transient upstream failure");
  });
  const cache = new AsyncCache<string, string>({ ttlMs: 1000, errorTtlMs: 500 }, loader);

  await expect(cache.getOrLoad("a")).rejects.toThrow("transient upstream failure");
  expect(loader).toHaveBeenCalledTimes(1);

  await expect(cache.getOrLoad("a")).rejects.toThrow("transient upstream failure");
  expect(loader).toHaveBeenCalledTimes(1); // still within errorTtlMs

  jest.advanceTimersByTime(500);
  await expect(cache.getOrLoad("a")).rejects.toThrow("transient upstream failure");
  expect(loader).toHaveBeenCalledTimes(2); // errorTtlMs expired, retried
});

test("LRU eviction removes the least-recently-touched entry once over maxSize", async () => {
  const loader = jest.fn(async (key: string) => `value-${key}`);
  const cache = new AsyncCache<string, string>({ ttlMs: 100_000, maxSize: 2 }, loader);

  await cache.getOrLoad("a");
  await cache.getOrLoad("b");
  expect(cache.has("a")).toBe(true);
  expect(cache.has("b")).toBe(true);

  await cache.getOrLoad("c"); // pushes size to 3, "a" is least-recently-touched
  expect(cache.has("a")).toBe(false);
  expect(cache.has("b")).toBe(true);
  expect(cache.has("c")).toBe(true);
});

test("touching an entry (get/getOrLoad) protects it from LRU eviction", async () => {
  const loader = jest.fn(async (key: string) => `value-${key}`);
  const cache = new AsyncCache<string, string>({ ttlMs: 100_000, maxSize: 2 }, loader);

  await cache.getOrLoad("a");
  await cache.getOrLoad("b");
  cache.get("a"); // touch "a" so "b" becomes least-recently-touched

  await cache.getOrLoad("c");
  expect(cache.has("a")).toBe(true);
  expect(cache.has("b")).toBe(false);
  expect(cache.has("c")).toBe(true);
});

test("concurrent cold loads for the same key are deduped to a single loader call", async () => {
  const gate = deferred<string>();
  const loader = jest.fn(() => gate.promise);
  const cache = new AsyncCache<string, string>({ ttlMs: 1000 }, loader);

  const p1 = cache.getOrLoad("a");
  const p2 = cache.getOrLoad("a");
  gate.resolve("value-a");

  const [v1, v2] = await Promise.all([p1, p2]);
  expect(v1).toBe("value-a");
  expect(v2).toBe("value-a");
  expect(loader).toHaveBeenCalledTimes(1);
});

test("set() seeds the cache directly without invoking the loader", () => {
  const loader = jest.fn();
  const cache = new AsyncCache<string, string>({ ttlMs: 1000 }, loader);

  cache.set("a", "seeded-value");
  expect(cache.get("a")).toBe("seeded-value");
  expect(loader).not.toHaveBeenCalled();
});

test("invalidate() removes an entry so the next read reloads", async () => {
  const loader = jest.fn(async (key: string) => `value-${key}`);
  const cache = new AsyncCache<string, string>({ ttlMs: 100_000 }, loader);

  await cache.getOrLoad("a");
  cache.invalidate("a");
  expect(cache.get("a")).toBeUndefined();

  await cache.getOrLoad("a");
  expect(loader).toHaveBeenCalledTimes(2);
});

test("entries() yields only currently-valid values, not negative/error/loading entries", async () => {
  const loader = jest.fn(async (key: string) => {
    if (key === "bad") {
      throw new NotFoundError("nope");
    }
    return `value-${key}`;
  });
  const cache = new AsyncCache<string, string>({ ttlMs: 1000 }, loader);

  await cache.getOrLoad("a");
  await expect(cache.getOrLoad("bad")).rejects.toBeInstanceOf(NotFoundError);

  expect(Array.from(cache.entries())).toEqual([["a", "value-a"]]);
});

test("stop() is safe to call and does not throw", () => {
  const cache = new AsyncCache<string, string>({ ttlMs: 1000 }, jest.fn());
  expect(() => cache.stop()).not.toThrow();
});
