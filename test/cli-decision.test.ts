import { runDecision } from "../src/cli/decision";
import { CliOptions } from "../src/cli/args";
import * as sdkModule from "../src/sdk";

jest.mock("../src/sdk");

function baseOptions(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    help: false,
    showConfig: false,
    track: false,
    compare: [],
    environment: "dev",
    context: "{}",
    ...overrides,
  };
}

function fakeSdk() {
  return {
    getDecision: jest.fn().mockReturnValue({ active: true }),
    getFlagDecision: jest.fn().mockResolvedValue({ active: true }),
    getDecisionByKey: jest.fn().mockResolvedValue({ active: true }),
    stop: jest.fn(),
    setTraceLevel: jest.fn(),
    setTraceListener: jest.fn(),
    getDeferredDecision: jest.fn(),
    getDecisions: jest.fn(),
    getDeferredDecisions: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("--show-config resolves URLs without constructing an SDK", async () => {
  const result = await runDecision(baseOptions({ showConfig: true, environment: "stage" }));
  expect(result).toMatchObject({ environment: "stage" });
  expect(sdkModule.NewSDKFromConfig).not.toHaveBeenCalled();
});

test("throws when --context is missing (and not --show-config)", async () => {
  await expect(runDecision(baseOptions({ context: undefined, expId: "exp-1" }))).rejects.toThrow(
    "--context is required",
  );
});

test("dispatches to getDecision when --exp-id is set", async () => {
  const sdk = fakeSdk();
  (sdkModule.NewSDKFromConfig as jest.Mock).mockResolvedValue(sdk);

  const result = await runDecision(baseOptions({ expId: "exp-1", seed: "s1" }));

  expect(sdk.getDecision).toHaveBeenCalledWith({ experimentId: "exp-1", seedId: "s1", context: {} });
  expect(sdk.stop).toHaveBeenCalledTimes(1);
  expect(result).toEqual({ active: true });
});

test("dispatches to getFlagDecision when --flag-id is set", async () => {
  const sdk = fakeSdk();
  (sdkModule.NewSDKFromConfig as jest.Mock).mockResolvedValue(sdk);

  await runDecision(baseOptions({ flagId: "flag-1", seed: "s1" }));

  expect(sdk.getFlagDecision).toHaveBeenCalledWith({ flagId: "flag-1", seedId: "s1", context: {} });
  expect(sdk.stop).toHaveBeenCalledTimes(1);
});

test("dispatches to getDecisionByKey when --flag-key and --project-id are set", async () => {
  const sdk = fakeSdk();
  (sdkModule.NewSDKFromConfig as jest.Mock).mockResolvedValue(sdk);

  await runDecision(baseOptions({ flagKey: "my-flag", projectId: "proj-1", seed: "s1" }));

  expect(sdk.getDecisionByKey).toHaveBeenCalledWith({
    projectId: "proj-1",
    key: "my-flag",
    seedId: "s1",
    context: {},
  });
});

test("--flag-key without --project-id throws, and still stops the SDK", async () => {
  const sdk = fakeSdk();
  (sdkModule.NewSDKFromConfig as jest.Mock).mockResolvedValue(sdk);

  await expect(runDecision(baseOptions({ flagKey: "my-flag" }))).rejects.toThrow("requires --project-id");
  expect(sdk.stop).toHaveBeenCalledTimes(1);
});

test("throws when no decision target is specified", async () => {
  const sdk = fakeSdk();
  (sdkModule.NewSDKFromConfig as jest.Mock).mockResolvedValue(sdk);

  await expect(runDecision(baseOptions())).rejects.toThrow("specify --exp-id, --flag-id, or --flag-key");
});

test("defaults trackUrl to a null: sink unless --track is passed", async () => {
  const sdk = fakeSdk();
  (sdkModule.NewSDKFromConfig as jest.Mock).mockResolvedValue(sdk);

  await runDecision(baseOptions({ expId: "exp-1" }));

  const [config] = (sdkModule.NewSDKFromConfig as jest.Mock).mock.calls[0];
  expect(config.trackUrl).toBe("null:");
});

test("--track uses the real resolved trackUrl instead of the null: sink", async () => {
  const sdk = fakeSdk();
  (sdkModule.NewSDKFromConfig as jest.Mock).mockResolvedValue(sdk);

  await runDecision(baseOptions({ expId: "exp-1", track: true }));

  const [config] = (sdkModule.NewSDKFromConfig as jest.Mock).mock.calls[0];
  expect(config.trackUrl).not.toBe("null:");
});

test("rejects an unknown --env before constructing an SDK", async () => {
  await expect(runDecision(baseOptions({ environment: "bogus", expId: "exp-1" }))).rejects.toThrow(
    "Unknown --env",
  );
  expect(sdkModule.NewSDKFromConfig).not.toHaveBeenCalled();
});

test("rejects an unknown --trace level before constructing an SDK", async () => {
  await expect(runDecision(baseOptions({ expId: "exp-1", traceLevel: "not-a-level" }))).rejects.toThrow(
    "Unknown --trace level",
  );
  expect(sdkModule.NewSDKFromConfig).not.toHaveBeenCalled();
});
