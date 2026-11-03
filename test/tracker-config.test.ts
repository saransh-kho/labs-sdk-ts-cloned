import { DefaultTracer } from "../src/internal/default_tracer";
import { Tracer } from "../src/internal/tracer";
import { Tracker } from "../src/internal/tracker";
import { DecisionRequest, DecisionResponse, LabsTraceLevel } from "../src/types";
import { FetchFn } from "../src/internal/http";

const testTracer = new Tracer(new DefaultTracer(), LabsTraceLevel.ERROR);

const request: DecisionRequest = { experimentId: "exp-1", seedId: "seed-1", context: { profileId: "p-1" } };
const decision: DecisionResponse = {
  experimentId: "exp-1",
  status: "success",
  active: true,
  control: false,
  treatmentId: "t1",
  label: "T1",
};

function fakeFetch(): jest.Mock {
  return jest.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response);
}

test("track() uses the injected fetchFn instead of global fetch", async () => {
  const globalFetchSpy = jest.spyOn(global, "fetch");
  const fetchFn = fakeFetch();

  const tracker = new Tracker("http://track.example.com", { fetchFn });
  await tracker.track(request, decision, 1, testTracer);

  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(globalFetchSpy).not.toHaveBeenCalled();
  globalFetchSpy.mockRestore();
});

test("a second identical track() call within the dedupe window is suppressed", async () => {
  const fetchFn = fakeFetch();
  const tracker = new Tracker("http://track.example.com", { fetchFn, dedupeTtlMs: 60_000 });

  await tracker.track(request, decision, 1, testTracer);
  await tracker.track(request, decision, 1, testTracer);

  expect(fetchFn).toHaveBeenCalledTimes(1);
});

test("a track() call with a different bucket is not suppressed", async () => {
  const fetchFn = fakeFetch();
  const tracker = new Tracker("http://track.example.com", { fetchFn, dedupeTtlMs: 60_000 });

  await tracker.track(request, decision, 1, testTracer);
  await tracker.track(request, decision, 2, testTracer);

  expect(fetchFn).toHaveBeenCalledTimes(2);
});

test("a track() call with different contextOverrides is not suppressed", async () => {
  const fetchFn = fakeFetch();
  const tracker = new Tracker("http://track.example.com", { fetchFn, dedupeTtlMs: 60_000 });

  await tracker.track(request, decision, 1, testTracer);
  await tracker.track(request, decision, 1, testTracer, { newKey: "newValue" });

  expect(fetchFn).toHaveBeenCalledTimes(2);
});

test("dedupeEnabled: false disables throttling entirely", async () => {
  const fetchFn = fakeFetch();
  const tracker = new Tracker("http://track.example.com", { fetchFn, dedupeEnabled: false });

  await tracker.track(request, decision, 1, testTracer);
  await tracker.track(request, decision, 1, testTracer);

  expect(fetchFn).toHaveBeenCalledTimes(2);
});

test("dedupe is on by default (no options passed)", async () => {
  const fetchFn = fakeFetch();
  const tracker = new Tracker("http://track.example.com", { fetchFn });

  await tracker.track(request, decision, 1, testTracer);
  await tracker.track(request, decision, 1, testTracer);

  expect(fetchFn).toHaveBeenCalledTimes(1);
});

test("track() honors a configured timeoutMs and reports a timeout via the tracer", async () => {
  jest.useFakeTimers();
  try {
    const events: string[] = [];
    const tracerStub = {
      traceId: "t",
      trace: (_level: LabsTraceLevel, id: string) => events.push(id),
    };
    const fetchFn: FetchFn = jest.fn((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    const tracker = new Tracker("http://track.example.com", { fetchFn, timeoutMs: 50 });
    const trackPromise = tracker.track(request, decision, 1, tracerStub);
    jest.advanceTimersByTime(50);
    await trackPromise;

    expect(events).toContain("TRACK");
  } finally {
    jest.useRealTimers();
  }
});
