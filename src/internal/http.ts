// Shared fetch wrapper: bounds every request with a timeout (via
// AbortController - no request in this SDK previously had one, so a hung
// upstream would hang forever) and accepts an injectable fetch implementation
// so callers/tests can swap in a fake instead of monkey-patching the global
// (jest.spyOn(global, "fetch") still works too - FetchFn defaults to it).
import { NotFoundError } from "./cache";

export type FetchFn = typeof fetch;

export const DefaultRequestTimeoutMs = 10_000;

export class RequestTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
    // ES5-target transpilation breaks the prototype chain for classes
    // extending built-ins (Error) unless explicitly restored.
    Object.setPrototypeOf(this, RequestTimeoutError.prototype);
  }
}

export type FetchOptions = {
  timeoutMs?: number;
  fetchFn?: FetchFn;
};

export function resolveFetchOptions(options?: FetchOptions): { timeoutMs: number; fetchFn: FetchFn } {
  return {
    timeoutMs: options?.timeoutMs ?? DefaultRequestTimeoutMs,
    fetchFn: options?.fetchFn ?? fetch,
  };
}

export async function fetchWithTimeout(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new RequestTimeoutError(url, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Reads a fetch Response as JSON, treating a bare 404 as a clean
// NotFoundError regardless of body content. Discovered against the real
// debug-experiments endpoint (not caught by any mocked-fetch test, which
// always mocked a 200 with a {message, data: null} envelope): a genuinely
// missing id returns HTTP 404 with an EMPTY body, and calling
// response.json() unconditionally on that throws a confusing "Unexpected end
// of JSON input" instead of a clean, cacheable not-found - which silently
// broke negative caching for every real 404 (miscategorized as a transient
// error with a short errorTtlMs, instead of the intended longer
// negativeTtlMs).
export async function readJsonOrNotFound<T>(response: Response, notFoundMessage: string): Promise<T> {
  if (response.status === 404) {
    throw new NotFoundError(notFoundMessage);
  }
  const text = await response.text();
  if (!text) {
    throw new Error(`empty response body from ${response.url} (status ${response.status})`);
  }
  return JSON.parse(text) as T;
}

// The Labs read endpoints (experiment config, flag by id/key, flags by
// project) all return the same `{ message, data }` envelope, where a missing
// resource is signalled either by a 404 (handled in readJsonOrNotFound) or a
// 200 with `data: null`. This is the single shared fetch+parse path for all
// of them - each loader is then just a URL + a not-found message. Mirrors
// Go's one doRequest parse path and Java's HttpFetchSupport, rather than
// hand-copying the same five steps per endpoint.
type FetchEnvelope<T> = { message: string; data: T | null };

export async function fetchEnvelopeData<T>(
  url: string,
  notFoundMessage: string,
  options?: FetchOptions,
): Promise<T> {
  const { timeoutMs, fetchFn } = resolveFetchOptions(options);
  const response = await fetchWithTimeout(fetchFn, url, undefined, timeoutMs);
  const { data } = await readJsonOrNotFound<FetchEnvelope<T>>(response, notFoundMessage);
  if (data == null) {
    throw new NotFoundError(notFoundMessage);
  }
  return data;
}
