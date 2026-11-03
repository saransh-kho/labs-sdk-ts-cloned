import { fetchOneExperimentConfig, getExperimentConfigs } from "../src/experiment";
import { NotFoundError } from "../src/internal/cache";
import { ExperimentConfiguration, SDKConfig } from "../src/types";

function mockFetchJson(responses: Record<string, unknown>) {
  const spy = jest.fn((url: string) => {
    const id = url.split("/").pop() as string;
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

function mockFetch404() {
  const spy = jest.fn((url: string) =>
    Promise.resolve({
      json: () => Promise.reject(new Error("Unexpected end of JSON input")),
      text: () => Promise.resolve(""),
      ok: false,
      status: 404,
      url,
    }),
  );
  jest.spyOn(global, "fetch").mockImplementation(spy as unknown as typeof fetch);
  return spy;
}

function config(): ExperimentConfiguration {
  return {
    experiment_id: "exp-1",
    treatments: [],
    treatment_ids: [],
    experiment_type: "",
    algorithm_type: "BASIC",
    total_enabled: false,
    is_feature: false,
    published: true,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

test("fetchOneExperimentConfig returns the config when found", async () => {
  const cfg = config();
  mockFetchJson({ "exp-1": { message: "ok", data: cfg } });

  const result = await fetchOneExperimentConfig("http://fetch", "exp-1");
  expect(result).toEqual(cfg);
});

test("fetchOneExperimentConfig throws a NotFoundError when data is null", async () => {
  mockFetchJson({ "missing-id": { message: "not found", data: null } });

  await expect(fetchOneExperimentConfig("http://fetch", "missing-id")).rejects.toBeInstanceOf(NotFoundError);
  await expect(fetchOneExperimentConfig("http://fetch", "missing-id")).rejects.toThrow(
    "no config found for experiment id: missing-id",
  );
});

test("getExperimentConfigs fetches every id sequentially and returns them in order", async () => {
  const cfgA = { ...config(), experiment_id: "a" };
  const cfgB = { ...config(), experiment_id: "b" };
  const spy = mockFetchJson({
    a: { message: "ok", data: cfgA },
    b: { message: "ok", data: cfgB },
  });

  const sdkConfig: SDKConfig = { fetchUrl: "http://fetch", trackUrl: "null:", experimentIds: ["a", "b"] };
  const results = await getExperimentConfigs(sdkConfig);

  expect(results).toEqual([cfgA, cfgB]);
  expect(spy).toHaveBeenCalledTimes(2);
});

test("fetchOneExperimentConfig treats a bare 404 with an empty body as NotFoundError (real upstream behavior)", async () => {
  mockFetch404();
  await expect(fetchOneExperimentConfig("http://fetch", "missing-id")).rejects.toBeInstanceOf(NotFoundError);
});

test("getExperimentConfigs throws (as a generic Error, unchanged from before) when any id is missing", async () => {
  mockFetchJson({
    a: { message: "ok", data: config() },
    b: { message: "not found", data: null },
  });

  const sdkConfig: SDKConfig = { fetchUrl: "http://fetch", trackUrl: "null:", experimentIds: ["a", "b"] };
  await expect(getExperimentConfigs(sdkConfig)).rejects.toThrow("no config found for experiment id: b");
});
