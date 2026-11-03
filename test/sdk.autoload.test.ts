import * as sdkModule from "../src/sdk";
import {
  DecisionRequest,
  DecisionResponse,
  FeatureFlag,
  LabsDecisionTracer,
  LabsTraceFields,
  LabsTraceLevel,
  SDKConfig,
} from "../src/types";
import { PublishedExperimentFixtureWithPercentageTraffic } from "./fixtures/experimentConfig";
import { ExperimentConfigStore } from "../src/internal/experiment-store";
import { FlagStore } from "../src/flag-store";

jest.mock("../src/internal/tracker");

const config = PublishedExperimentFixtureWithPercentageTraffic;

function mockFetchJson() {
  const spy = jest.fn((url: string) => {
    const id = url.split("/").pop() as string;
    if (id !== config.experiment_id) {
      return Promise.resolve({
        json: () => Promise.reject(new Error("Unexpected end of JSON input")),
        text: () => Promise.resolve(""),
        ok: false,
        status: 404,
        url,
      });
    }
    return Promise.resolve({
      json: () => Promise.resolve({ message: "ok", data: config }),
      text: () => Promise.resolve(JSON.stringify({ message: "ok", data: config })),
      ok: true,
      status: 200,
      url,
    });
  });
  jest.spyOn(global, "fetch").mockImplementation(spy as unknown as typeof fetch);
  return spy;
}

function sdkConfig(): SDKConfig {
  return { fetchUrl: "http://fetch", trackUrl: "null:", experimentIds: [config.experiment_id] };
}

function stripNonDeterministicFields(decision: DecisionResponse): Omit<DecisionResponse, "traceId"> {
  const { traceId: _traceId, ...rest } = decision;
  return rest;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test("NewSDK stays synchronous - it does not return a Promise", () => {
  const result = sdkModule.NewSDK(sdkConfig(), [config]);
  expect(result).not.toBeInstanceOf(Promise);
  expect(typeof result.getDecision).toBe("function");
});

test("NewSDKFromConfig and NewSDK produce identical decisions for the same input", async () => {
  mockFetchJson();
  const request: DecisionRequest = { experimentId: config.experiment_id, seedId: "test123" };

  const syncSdk = sdkModule.NewSDK(sdkConfig(), [config]);
  const asyncSdk = await sdkModule.NewSDKFromConfig(sdkConfig());

  const syncDecision = syncSdk.getDecision(request);
  const asyncDecision = asyncSdk.getDecision(request);

  expect(stripNonDeterministicFields(asyncDecision)).toEqual(stripNonDeterministicFields(syncDecision));
});

test("NewSDKFromConfig honors setTraceListener/setTraceLevel exactly like NewSDK, plus additive cache events", async () => {
  mockFetchJson();
  const request: DecisionRequest = { experimentId: config.experiment_id, seedId: "test123" };

  const syncEvents: [LabsTraceLevel, string, string, LabsTraceFields][] = [];
  const syncTracer: LabsDecisionTracer = {
    OnTrace: (level, _ts, id, message, fields) => syncEvents.push([level, id, message, fields]),
    flush: () => undefined,
  };
  const syncSdk = sdkModule.NewSDK(sdkConfig(), [config]);
  syncSdk.setTraceLevel(LabsTraceLevel.DEBUG);
  syncSdk.setTraceListener(syncTracer);
  syncSdk.getDecision(request);

  const asyncEvents: [LabsTraceLevel, string, string, LabsTraceFields][] = [];
  const asyncTracer: LabsDecisionTracer = {
    OnTrace: (level, _ts, id, message, fields) => asyncEvents.push([level, id, message, fields]),
    flush: () => undefined,
  };
  const asyncSdk = await sdkModule.NewSDKFromConfig(sdkConfig());
  asyncSdk.setTraceLevel(LabsTraceLevel.DEBUG);
  asyncSdk.setTraceListener(asyncTracer);
  asyncSdk.getDecision(request);

  // Every decision-time trace event from the sync path must appear, in the
  // same order, in the async path - cache events are additive, never a
  // replacement.
  const asyncEventIds = asyncEvents.map(([, id]) => id);
  const syncEventIds = syncEvents.map(([, id]) => id);
  let cursor = 0;
  for (const id of syncEventIds) {
    const found = asyncEventIds.indexOf(id, cursor);
    expect(found).toBeGreaterThanOrEqual(0); // -1 means the sync event is missing from the async path
    cursor = found + 1;
  }

  // And the async path has additional component:"cache" events the sync path
  // never produces.
  expect(asyncEvents.some(([, , , fields]) => fields["component"] === "cache")).toBe(true);
  expect(syncEvents.some(([, , , fields]) => fields["component"] === "cache")).toBe(false);
});

test("NewSDKFromConfig rejects when a requested experiment id cannot be loaded", async () => {
  mockFetchJson();
  const badConfig: SDKConfig = {
    fetchUrl: "http://fetch",
    trackUrl: "null:",
    experimentIds: ["does-not-exist"],
  };
  await expect(sdkModule.NewSDKFromConfig(badConfig)).rejects.toThrow(
    "no config found for experiment id: does-not-exist",
  );
});

test("NewSDKFromConfig keeps the cache warm via live decision traffic (fire-and-forget touch)", async () => {
  mockFetchJson();
  const ensureSpy = jest.spyOn(ExperimentConfigStore.prototype, "ensure");

  const asyncSdk = await sdkModule.NewSDKFromConfig(sdkConfig());
  const callsAfterWarmup = ensureSpy.mock.calls.length;

  asyncSdk.getDecision({ experimentId: config.experiment_id, seedId: "test123" });
  expect(ensureSpy.mock.calls.length).toBeGreaterThan(callsAfterWarmup);
});

describe("Feature flags", () => {
  const flag: FeatureFlag = {
    uuid: "flag-1",
    key: "my-flag",
    projectId: "project-1",
    metadata: { status: true, schemaVersionNumber: 0, variants: [{ uuid: "v1", name: "only" }] },
  };

  function mockFetchWithFlags() {
    const jsonResponse = (url: string, body: unknown) => ({
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
      ok: true,
      status: 200,
      url,
    });
    const notFoundResponse = (url: string) => ({
      json: () => Promise.reject(new Error("Unexpected end of JSON input")),
      text: () => Promise.resolve(""),
      ok: false,
      status: 404,
      url,
    });
    const spy = jest.fn((url: string) => {
      const id = url.split("/").pop() as string;
      if (url.includes("/project/project-1/key/my-flag")) {
        return Promise.resolve(jsonResponse(url, { message: "ok", data: flag }));
      }
      if (id === flag.uuid) {
        return Promise.resolve(jsonResponse(url, { message: "ok", data: flag }));
      }
      if (id === config.experiment_id) {
        return Promise.resolve(jsonResponse(url, { message: "ok", data: config }));
      }
      return Promise.resolve(notFoundResponse(url));
    });
    jest.spyOn(global, "fetch").mockImplementation(spy as unknown as typeof fetch);
    return spy;
  }

  test("getFlagDecision resolves a real decision through NewSDKFromConfig", async () => {
    mockFetchWithFlags();
    const asyncSdk = await sdkModule.NewSDKFromConfig(sdkConfig());
    const decision = await asyncSdk.getFlagDecision({ flagId: flag.uuid, seedId: "s1" });
    expect(decision.variantKey).toBe("only");
    expect(decision.active).toBe(true);
  });

  test("getDecisionByKey resolves via project+key", async () => {
    mockFetchWithFlags();
    const asyncSdk = await sdkModule.NewSDKFromConfig(sdkConfig());
    const decision = await asyncSdk.getDecisionByKey({
      projectId: "project-1",
      key: "my-flag",
      seedId: "s1",
    });
    expect(decision.variantKey).toBe("only");
  });

  test("getFlagDecision on a NewSDK (sync path) SDK resolves to an inactive decision, never throws", async () => {
    mockFetchWithFlags();
    const syncSdk = sdkModule.NewSDK(sdkConfig(), [config]);
    const decision = await syncSdk.getFlagDecision({ flagId: flag.uuid, seedId: "s1" });
    expect(decision.active).toBe(false);
  });

  test("flag cache lifecycle events are traced with component:'cache' and store:'flag'", async () => {
    mockFetchWithFlags();
    const events: LabsTraceFields[] = [];
    const tracer: LabsDecisionTracer = {
      OnTrace: (_level, _ts, _id, _message, fields) => events.push(fields),
      flush: () => undefined,
    };
    const asyncSdk = await sdkModule.NewSDKFromConfig(sdkConfig());
    asyncSdk.setTraceLevel(LabsTraceLevel.DEBUG);
    asyncSdk.setTraceListener(tracer);
    await asyncSdk.getFlagDecision({ flagId: flag.uuid, seedId: "s1" });

    expect(events.some((f) => f["component"] === "cache" && f["store"] === "flag")).toBe(true);
  });
});

describe("stop()", () => {
  test("is safe to call on a NewSDK (sync path) SDK, which has nothing to clean up", () => {
    const syncSdk = sdkModule.NewSDK(sdkConfig(), [config]);
    expect(() => syncSdk.stop()).not.toThrow();
  });

  test("is safe to call on a NewSDKFromConfig SDK and stops both underlying stores", async () => {
    mockFetchJson();
    const experimentStoreStop = jest.spyOn(ExperimentConfigStore.prototype, "stop");
    const flagStoreStop = jest.spyOn(FlagStore.prototype, "stop");

    const asyncSdk = await sdkModule.NewSDKFromConfig(sdkConfig());
    asyncSdk.stop();

    expect(experimentStoreStop).toHaveBeenCalledTimes(1);
    expect(flagStoreStop).toHaveBeenCalledTimes(1);
  });
});
