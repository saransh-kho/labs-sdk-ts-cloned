import { ExperimentConfigStore } from "../src/internal/experiment-store";
import { CacheTraceEvent } from "../src/internal/cache";
import { ExperimentConfiguration } from "../src/types";
import { ResolvedSDKConfig } from "../src/internal/environment-urls";

function baseConfig(overrides: Partial<ExperimentConfiguration>): ExperimentConfiguration {
  return {
    experiment_id: "exp-1",
    treatments: [],
    treatment_ids: [],
    experiment_type: "",
    algorithm_type: "BASIC",
    total_enabled: false,
    is_feature: false,
    published: true,
    ...overrides,
  };
}

function mockFetchJson(responses: Record<string, unknown>) {
  const spy = jest.fn((url: string) => {
    const id = url.split("/").pop() as string;
    if (!(id in responses)) {
      return Promise.resolve({
        json: () => Promise.reject(new Error("Unexpected end of JSON input")),
        text: () => Promise.resolve(""),
        ok: false,
        status: 404,
        url,
      });
    }
    return Promise.resolve({
      json: () => Promise.resolve(responses[id]),
      text: () => Promise.resolve(JSON.stringify(responses[id])),
      ok: true,
      status: 200,
      url,
    });
  });
  jest.spyOn(global, "fetch").mockImplementation(spy as unknown as typeof fetch);
  return spy;
}

function sdkConfig(experimentIds: string[]): ResolvedSDKConfig {
  return { fetchUrl: "http://fetch", trackUrl: "null:", experimentIds };
}

afterEach(() => {
  jest.restoreAllMocks();
});

test("warmup() loads every requested id and populates the live experimentsMap", async () => {
  const cfgA = baseConfig({ experiment_id: "a" });
  const cfgB = baseConfig({ experiment_id: "b" });
  mockFetchJson({
    a: { message: "ok", data: cfgA },
    b: { message: "ok", data: cfgB },
  });

  const store = new ExperimentConfigStore(sdkConfig(["a", "b"]));
  await store.warmup();

  expect(store.experimentsMap["a"]).toEqual(cfgA);
  expect(store.experimentsMap["b"]).toEqual(cfgB);
});

test("warmup() rejects when an originally-requested id cannot be loaded", async () => {
  mockFetchJson({
    a: { message: "ok", data: baseConfig({ experiment_id: "a" }) },
    // "b" intentionally not in responses -> 404/not-found
  });

  const store = new ExperimentConfigStore(sdkConfig(["a", "b"]));
  await expect(store.warmup()).rejects.toThrow("no config found for experiment id: b");
});

test("warmup() recursively prefetches a program-holdout parent not in experimentIds", async () => {
  const parent = baseConfig({ experiment_id: "parent-program", is_program: true });
  const child = baseConfig({ experiment_id: "child-exp", parent_experiment_id: "parent-program" });
  mockFetchJson({
    "child-exp": { message: "ok", data: child },
    "parent-program": { message: "ok", data: parent },
  });

  const store = new ExperimentConfigStore(sdkConfig(["child-exp"]));
  await store.warmup();

  expect(store.experimentsMap["child-exp"]).toEqual(child);
  expect(store.experimentsMap["parent-program"]).toEqual(parent);
});

test("warmup() does not fail when a parent (not explicitly requested) cannot be loaded", async () => {
  const child = baseConfig({ experiment_id: "child-exp", parent_experiment_id: "missing-parent" });
  mockFetchJson({
    "child-exp": { message: "ok", data: child },
    // "missing-parent" intentionally absent
  });

  const store = new ExperimentConfigStore(sdkConfig(["child-exp"]));
  await expect(store.warmup()).resolves.toBeUndefined();

  expect(store.experimentsMap["child-exp"]).toEqual(child);
  expect(store.experimentsMap["missing-parent"]).toBeUndefined();
});

test("warmup() prefetches multiple levels of grandparent holdouts", async () => {
  const grandparent = baseConfig({ experiment_id: "grandparent", is_program: true });
  const parent = baseConfig({
    experiment_id: "parent",
    is_program: true,
    parent_experiment_id: "grandparent",
  });
  const child = baseConfig({ experiment_id: "child", parent_experiment_id: "parent" });
  mockFetchJson({
    child: { message: "ok", data: child },
    parent: { message: "ok", data: parent },
    grandparent: { message: "ok", data: grandparent },
  });

  const store = new ExperimentConfigStore(sdkConfig(["child"]));
  await store.warmup();

  expect(store.experimentsMap["child"]).toBeDefined();
  expect(store.experimentsMap["parent"]).toBeDefined();
  expect(store.experimentsMap["grandparent"]).toBeDefined();
});

test("ensure() never rejects, and removes the id from experimentsMap on failure", async () => {
  mockFetchJson({});
  const store = new ExperimentConfigStore(sdkConfig([]));

  await expect(store.ensure("missing")).resolves.toBeUndefined();
  expect(store.experimentsMap["missing"]).toBeUndefined();
});

test("ensure() writes through into experimentsMap on success", async () => {
  const cfg = baseConfig({ experiment_id: "a" });
  mockFetchJson({ a: { message: "ok", data: cfg } });
  const store = new ExperimentConfigStore(sdkConfig([]));

  await store.ensure("a");
  expect(store.experimentsMap["a"]).toEqual(cfg);
});

test("cache lifecycle events are forwarded to the onEvent sink", async () => {
  const cfg = baseConfig({ experiment_id: "a" });
  mockFetchJson({ a: { message: "ok", data: cfg } });
  const events: CacheTraceEvent[] = [];

  const store = new ExperimentConfigStore(sdkConfig(["a"]), (e) => events.push(e));
  await store.warmup();

  expect(events.some((e) => e.op === "load")).toBe(true);
});

test("stop() is safe to call and does not throw", () => {
  const store = new ExperimentConfigStore(sdkConfig([]));
  expect(() => store.stop()).not.toThrow();
});
