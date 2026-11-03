import { fetchWithTimeout, RequestTimeoutError, FetchFn } from "../src/internal/http";

test("fetchWithTimeout passes the call through to fetchFn with an AbortSignal attached", async () => {
  const fetchFn: FetchFn = jest.fn(async (_input, init) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return { ok: true } as Response;
  });

  const response = await fetchWithTimeout(fetchFn, "http://example.com", { method: "GET" }, 1000);
  expect(response.ok).toBe(true);
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

test("fetchWithTimeout lets a custom fetchFn be injected instead of the global fetch", async () => {
  const calls: (string | URL | Request)[] = [];
  const fetchFn: FetchFn = jest.fn(async (input) => {
    calls.push(input);
    return { ok: true } as Response;
  });

  await fetchWithTimeout(fetchFn, "http://custom.example.com/x", undefined, 1000);
  expect(calls).toEqual(["http://custom.example.com/x"]);
});

test("fetchWithTimeout aborts and throws RequestTimeoutError when the timeout elapses", async () => {
  jest.useFakeTimers();
  try {
    const fetchFn: FetchFn = jest.fn((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    const promise = fetchWithTimeout(fetchFn, "http://slow.example.com", undefined, 100);
    const assertion = expect(promise).rejects.toBeInstanceOf(RequestTimeoutError);
    jest.advanceTimersByTime(100);
    await assertion;
  } finally {
    jest.useRealTimers();
  }
});

test("fetchWithTimeout propagates a non-abort error unchanged", async () => {
  const fetchFn: FetchFn = jest.fn(async () => {
    throw new Error("dns failure");
  });

  await expect(fetchWithTimeout(fetchFn, "http://example.com", undefined, 1000)).rejects.toThrow(
    "dns failure",
  );
});
