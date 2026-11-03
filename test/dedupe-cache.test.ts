import { DedupeCache } from "../src/internal/dedupe-cache";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test("the first time a key is seen it is not throttled", () => {
  const cache = new DedupeCache(10, 1000);
  expect(cache.shouldThrottle("a")).toBe(false);
});

test("a repeated key within the TTL window is throttled", () => {
  const cache = new DedupeCache(10, 1000);
  expect(cache.shouldThrottle("a")).toBe(false);
  jest.advanceTimersByTime(500);
  expect(cache.shouldThrottle("a")).toBe(true);
});

test("a repeated key after the TTL window has elapsed is not throttled", () => {
  const cache = new DedupeCache(10, 1000);
  expect(cache.shouldThrottle("a")).toBe(false);
  jest.advanceTimersByTime(1000);
  expect(cache.shouldThrottle("a")).toBe(false);
});

test("distinct keys never throttle each other", () => {
  const cache = new DedupeCache(10, 1000);
  expect(cache.shouldThrottle("a")).toBe(false);
  expect(cache.shouldThrottle("b")).toBe(false);
});

test("evicts the least-recently-seen key once over maxSize", () => {
  const cache = new DedupeCache(2, 100_000);
  cache.shouldThrottle("a");
  cache.shouldThrottle("b");
  expect(cache.size()).toBe(2);

  cache.shouldThrottle("c"); // pushes size to 3, "a" is least-recently-seen
  expect(cache.size()).toBe(2);

  // "a" was evicted, so it's no longer throttled even though we're still
  // well within the TTL window - only "b" and "c" remain tracked.
  expect(cache.shouldThrottle("a")).toBe(false);
});
