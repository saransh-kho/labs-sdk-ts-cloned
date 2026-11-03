import { FlagStore } from "../src/flag-store";
import { CacheTraceEvent } from "../src/internal/cache";
import { FeatureFlag, SDKConfig } from "../src/types";
import { ResolvedSDKConfig } from "../src/internal/environment-urls";

function flag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    uuid: "flag-1",
    key: "my-flag",
    projectId: "project-1",
    metadata: { status: true, schemaVersionNumber: 0 },
    ...overrides,
  };
}

function sdkConfig(overrides: Partial<SDKConfig> = {}): ResolvedSDKConfig {
  return {
    fetchUrl: "http://fetch",
    trackUrl: "null:",
    experimentIds: [],
    flagFetchUrl: "http://flags",
    ...overrides,
  } as ResolvedSDKConfig;
}

function mockFetchRoutes(routes: Record<string, unknown>) {
  const spy = jest.fn((url: string) => {
    if (!(url in routes)) {
      return Promise.resolve({
        json: () => Promise.reject(new Error("Unexpected end of JSON input")),
        text: () => Promise.resolve(""),
        ok: false,
        status: 404,
        url,
      });
    }
    const body = routes[url];
    return Promise.resolve({
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
      ok: true,
      status: 200,
      url,
    });
  });
  jest.spyOn(global, "fetch").mockImplementation(spy as unknown as typeof fetch);
  return spy;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test("getById resolves a flag by id", async () => {
  const f = flag();
  mockFetchRoutes({ "http://flags/flag-1": { message: "ok", data: f } });
  const store = new FlagStore(sdkConfig());
  await expect(store.getById("flag-1")).resolves.toEqual(f);
});

test("getById returns undefined (never throws) when the flag is missing", async () => {
  mockFetchRoutes({});
  const store = new FlagStore(sdkConfig());
  await expect(store.getById("missing")).resolves.toBeUndefined();
});

test("getByKey resolves alias -> id -> byId, hydrating byId directly", async () => {
  const f = flag({ uuid: "flag-1", key: "my-key" });
  const spy = mockFetchRoutes({
    "http://flags/project/project-1/key/my-key": { message: "ok", data: f },
  });
  const store = new FlagStore(sdkConfig());

  const result = await store.getByKey("project-1", "my-key");
  expect(result).toEqual(f);

  // Second getById call for the same uuid must be served from the
  // byId cache hydrated by the by-key fetch - no second round trip.
  await store.getById("flag-1");
  expect(spy).toHaveBeenCalledTimes(1);
});

test("getByKey returns undefined when the key cannot be resolved", async () => {
  mockFetchRoutes({});
  const store = new FlagStore(sdkConfig());
  await expect(store.getByKey("project-1", "missing-key")).resolves.toBeUndefined();
});

test("getByProject resolves the bulk id list and hydrates byId for every flag", async () => {
  const flagA = flag({ uuid: "a" });
  const flagB = flag({ uuid: "b" });
  const spy = mockFetchRoutes({
    "http://flags/project/project-1": { message: "ok", data: [flagA, flagB] },
  });
  const store = new FlagStore(sdkConfig());

  const result = await store.getByProject("project-1");
  expect(result).toEqual([flagA, flagB]);

  // Individual getById calls for a/b must be served from the cache hydrated
  // by the bulk project fetch - no additional round trips.
  await store.getById("a");
  await store.getById("b");
  expect(spy).toHaveBeenCalledTimes(1);
});

test("getByProject returns an empty array when the project cannot be resolved", async () => {
  mockFetchRoutes({});
  const store = new FlagStore(sdkConfig());
  await expect(store.getByProject("missing-project")).resolves.toEqual([]);
});

test("warmup() prefetches configured flagIds and is a no-op when none are configured", async () => {
  const f = flag({ uuid: "seeded" });
  const spy = mockFetchRoutes({ "http://flags/seeded": { message: "ok", data: f } });

  const store = new FlagStore(sdkConfig({ flagIds: ["seeded"] }));
  await store.warmup();
  await store.getById("seeded");
  expect(spy).toHaveBeenCalledTimes(1); // warmup already loaded it

  const emptyStore = new FlagStore(sdkConfig());
  await expect(emptyStore.warmup()).resolves.toBeUndefined();
});

test("falls back to fetchUrl when flagFetchUrl is not configured", async () => {
  const f = flag();
  const spy = mockFetchRoutes({ "http://fetch/flag-1": { message: "ok", data: f } });
  const store = new FlagStore(sdkConfig({ flagFetchUrl: undefined }));
  await expect(store.getById("flag-1")).resolves.toEqual(f);
  expect(spy).toHaveBeenCalledWith(
    "http://fetch/flag-1",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

test("cache lifecycle events are tagged with the correct store label", async () => {
  const f = flag();
  mockFetchRoutes({ "http://flags/flag-1": { message: "ok", data: f } });
  const events: [string, CacheTraceEvent][] = [];
  const store = new FlagStore(sdkConfig(), (storeLabel, event) => events.push([storeLabel, event]));

  await store.getById("flag-1");
  expect(events.some(([storeLabel, event]) => storeLabel === "flag" && event.op === "load")).toBe(true);
});

test("stop() is safe to call and does not throw", () => {
  const store = new FlagStore(sdkConfig());
  expect(() => store.stop()).not.toThrow();
});
