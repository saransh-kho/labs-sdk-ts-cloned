import { resolveFlagSeed } from "../src/internal/seed";

test("resolves PROFILE_ID from context when no explicit seed type is given (default)", () => {
  const result = resolveFlagSeed(undefined, undefined, { profileId: "p-1" }, undefined, undefined);
  expect(result).toEqual({ seedId: "p-1", seedType: "PROFILE_ID" });
});

test("request-level profileId takes precedence and is used for PROFILE_ID", () => {
  const result = resolveFlagSeed(undefined, undefined, {}, "req-profile", undefined);
  expect(result).toEqual({ seedId: "req-profile", seedType: "PROFILE_ID" });
});

test("resolves USER_ID from context", () => {
  const result = resolveFlagSeed("USER_ID", undefined, { userId: "u-1" }, undefined, undefined);
  expect(result).toEqual({ seedId: "u-1", seedType: "USER_ID" });
});

test("resolves SESSION_ID from context", () => {
  const result = resolveFlagSeed("SESSION_ID", undefined, { sessionId: "s-1" }, undefined, undefined);
  expect(result).toEqual({ seedId: "s-1", seedType: "SESSION_ID" });
});

test("resolves DEVICE_ID from context", () => {
  const result = resolveFlagSeed("DEVICE_ID", undefined, { deviceId: "d-1" }, undefined, undefined);
  expect(result).toEqual({ seedId: "d-1", seedType: "DEVICE_ID" });
});

test("falls back to the explicit request seedId when the typed field is missing", () => {
  const result = resolveFlagSeed("USER_ID", "fallback-seed", {}, undefined, undefined);
  expect(result).toEqual({ seedId: "fallback-seed", seedType: "SEED_ID" });
});

test("an explicit request seedId wins over the typed field, as in Go and Java", () => {
  const result = resolveFlagSeed("USER_ID", "my-seed", { userId: "u-1" }, undefined, undefined);
  expect(result).toEqual({ seedId: "my-seed", seedType: "SEED_ID" });
});

test("falls back to a random UUID (not exclusion) when nothing resolves - Go/Java parity", () => {
  const result = resolveFlagSeed("USER_ID", undefined, {}, undefined, undefined);
  expect(result.seedType).toBe("NONE");
  expect(result.seedId).toBeDefined();
  expect(result.seedId.length).toBeGreaterThan(0);
});

test("SEED_ID type uses the explicit request seedId directly", () => {
  const result = resolveFlagSeed("SEED_ID", "my-seed", {}, undefined, undefined);
  expect(result).toEqual({ seedId: "my-seed", seedType: "SEED_ID" });
});
