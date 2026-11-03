import { fetchFeatureFlag, fetchFeatureFlagByKey, fetchFeatureFlagsByProject } from "../src/flag-loader";
import { NotFoundError } from "../src/internal/cache";
import { FeatureFlag } from "../src/types";

function flag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    uuid: "flag-1",
    key: "my-flag",
    projectId: "project-1",
    metadata: { status: true, schemaVersionNumber: 0 },
    ...overrides,
  };
}

function mockFetchJson(responder: (url: string) => unknown) {
  const spy = jest.fn((url: string) => {
    const body = responder(url);
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

afterEach(() => {
  jest.restoreAllMocks();
});

test("fetchFeatureFlag returns the flag when found", async () => {
  const f = flag();
  mockFetchJson(() => ({ message: "ok", data: f }));
  await expect(fetchFeatureFlag("http://fetch", "flag-1")).resolves.toEqual(f);
});

test("fetchFeatureFlag throws NotFoundError when data is null", async () => {
  mockFetchJson(() => ({ message: "not found", data: null }));
  await expect(fetchFeatureFlag("http://fetch", "missing")).rejects.toBeInstanceOf(NotFoundError);
});

test("fetchFeatureFlagByKey hits the project/key endpoint and returns the flag", async () => {
  const f = flag({ key: "my-key" });
  const spy = mockFetchJson(() => ({ message: "ok", data: f }));
  const result = await fetchFeatureFlagByKey("http://fetch", "project-1", "my-key");
  expect(result).toEqual(f);
  expect(spy).toHaveBeenCalledWith(
    "http://fetch/project/project-1/key/my-key",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

test("fetchFeatureFlagByKey throws NotFoundError when data is null", async () => {
  mockFetchJson(() => ({ message: "not found", data: null }));
  await expect(fetchFeatureFlagByKey("http://fetch", "project-1", "missing")).rejects.toBeInstanceOf(
    NotFoundError,
  );
});

test("fetchFeatureFlagsByProject hits the project endpoint and returns all flags", async () => {
  const flags = [flag({ uuid: "a" }), flag({ uuid: "b" })];
  const spy = mockFetchJson(() => ({ message: "ok", data: flags }));
  const result = await fetchFeatureFlagsByProject("http://fetch", "project-1");
  expect(result).toEqual(flags);
  expect(spy).toHaveBeenCalledWith(
    "http://fetch/project/project-1",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

test("fetchFeatureFlagsByProject throws NotFoundError when data is null", async () => {
  mockFetchJson(() => ({ message: "not found", data: null }));
  await expect(fetchFeatureFlagsByProject("http://fetch", "missing-project")).rejects.toBeInstanceOf(
    NotFoundError,
  );
});

test("fetchFeatureFlag treats a bare 404 with an empty body as NotFoundError (real upstream behavior)", async () => {
  mockFetch404();
  await expect(fetchFeatureFlag("http://fetch", "missing")).rejects.toBeInstanceOf(NotFoundError);
});
