import { EnvironmentUrls, resolveConfigUrls } from "../src/internal/environment-urls";
import { SDKConfig } from "../src/types";

function baseConfig(overrides: Partial<SDKConfig> = {}): SDKConfig {
  return { experimentIds: [], ...overrides };
}

test("explicit fetchUrl/trackUrl are used as-is when no environment is set", () => {
  const resolved = resolveConfigUrls(
    baseConfig({ fetchUrl: "http://custom", trackUrl: "http://custom-track" }),
  );
  expect(resolved.fetchUrl).toBe("http://custom");
  expect(resolved.trackUrl).toBe("http://custom-track");
});

test("environment resolves fetchUrl/trackUrl/flagFetchUrl when none is explicitly set", () => {
  const resolved = resolveConfigUrls(baseConfig({ environment: "stage" }));
  expect(resolved.fetchUrl).toBe(EnvironmentUrls.stage.fetchUrl);
  expect(resolved.trackUrl).toBe(EnvironmentUrls.stage.trackUrl);
  expect(resolved.flagFetchUrl).toBe(EnvironmentUrls.stage.flagFetchUrl);
});

test("the experiment fetch host is the backoffice subdomain, distinct from the flag/track host", () => {
  const resolved = resolveConfigUrls(baseConfig({ environment: "stage" }));
  expect(resolved.fetchUrl).toContain("backoffice.stg.api.discomax.com");
  expect(resolved.flagFetchUrl).toContain("stg.api.discomax.com");
  expect(resolved.flagFetchUrl).not.toContain("backoffice");
});

test("an explicit flagFetchUrl wins over environment", () => {
  const resolved = resolveConfigUrls(
    baseConfig({ environment: "stage", flagFetchUrl: "http://override-flags" }),
  );
  expect(resolved.flagFetchUrl).toBe("http://override-flags");
});

test("an explicit fetchUrl wins over environment even when both are set", () => {
  const resolved = resolveConfigUrls(baseConfig({ environment: "prod", fetchUrl: "http://override" }));
  expect(resolved.fetchUrl).toBe("http://override");
  expect(resolved.trackUrl).toBe(EnvironmentUrls.prod.trackUrl);
});

test("an explicit empty-string fetchUrl is preserved, not replaced by environment (studio's offline-mode usage)", () => {
  const resolved = resolveConfigUrls(baseConfig({ environment: "prod", fetchUrl: "", trackUrl: "null:" }));
  expect(resolved.fetchUrl).toBe("");
  expect(resolved.trackUrl).toBe("null:");
});

test("throws a clear error when neither fetchUrl nor environment is set", () => {
  expect(() => resolveConfigUrls(baseConfig({ trackUrl: "http://track" }))).toThrow(
    "SDKConfig requires either fetchUrl or environment to be set",
  );
});

test("throws a clear error when neither trackUrl nor environment is set", () => {
  expect(() => resolveConfigUrls(baseConfig({ fetchUrl: "http://fetch" }))).toThrow(
    "SDKConfig requires either trackUrl or environment to be set",
  );
});

test.each(["prod", "stage", "int", "dev"] as const)(
  "environment %s resolves to a distinct, complete URL triple",
  (env) => {
    const resolved = resolveConfigUrls(baseConfig({ environment: env }));
    expect(resolved.fetchUrl).toEqual(EnvironmentUrls[env].fetchUrl);
    expect(resolved.trackUrl).toEqual(EnvironmentUrls[env].trackUrl);
    expect(resolved.flagFetchUrl).toEqual(EnvironmentUrls[env].flagFetchUrl);
    expect(resolved.fetchUrl).not.toBe(resolved.trackUrl);
    expect(resolved.fetchUrl).not.toBe(resolved.flagFetchUrl);
  },
);
