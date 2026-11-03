import { PublishedExperimentFixture } from "./fixtures/experimentConfig";
import { getAnSDK, getDeferredDecisionFromSDK, waitFor } from "./test-utils";

const PublishedExpId = PublishedExperimentFixture.experiment_id;

describe("SDK Deferred Tracking Integration Tests", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test("should pass contextOverrides to deferred track and make fetch call end-to-end", async () => {
    // Mock fetch to capture the HTTP request
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    const decisionResponse = getDeferredDecisionFromSDK({ foo: "bar" });

    const contextOverrides = {
      customKey: "customValue",
      anotherKey: "anotherValue",
    };

    // Call deferred track (this is fire-and-forget, but internally async)
    decisionResponse.track(contextOverrides);

    // Wait for fetch to be called
    await waitFor(() => fetchSpy.mock.calls.length > 0);

    // Verify fetch was called with correct URL and payload
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/track",
      expect.objectContaining({
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: expect.any(String),
      }),
    );

    // Parse and verify the request payload
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("/track");
    expect(options?.body).toBeDefined();
    const payload = JSON.parse(options!.body as string);

    expect(payload).toMatchObject({
      experiment_id: PublishedExpId,
      treatment_id: "6fc0d6b1-fdbe-4007-bda9-e05c19592085",
      seed_id: "SomeSeed",
      bucket: expect.any(Number),
      context: expect.objectContaining({
        foo: "bar", // Original context
        customKey: "customValue", // Override context
        anotherKey: "anotherValue", // Override context
        _newkeys: "customKey, anotherKey", // Tracking of new keys added
      }),
    });

    fetchSpy.mockRestore();
  });

  test("should handle contextOverrides with overwritten keys in deferred track", async () => {
    // Mock fetch to capture the HTTP request
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    const initializedSDK = getAnSDK(null);
    const decisionResponse = initializedSDK.getDeferredDecision({
      experimentId: PublishedExpId,
      seedId: "SomeSeed",
      context: {
        profileId: "originalProfileId",
        userId: "originalUserId",
        existingKey: "originalValue",
      },
    });

    const contextOverrides = {
      existingKey: "overriddenValue",
      profileId: "overriddenProfileId", // This should be overridden in context but preserved in payload
      newKey: "newValue",
    };

    // Call deferred track
    decisionResponse.track(contextOverrides);

    // Wait for fetch to be called
    await waitFor(() => fetchSpy.mock.calls.length > 0);

    // Parse and verify the request payload
    const [url, options] = fetchSpy.mock.calls[0];
    const payload = JSON.parse(options!.body as string);

    expect(payload).toMatchObject({
      experiment_id: PublishedExpId,
      treatment_id: decisionResponse.decision.treatmentId,
      seed_id: "SomeSeed",
      bucket: expect.any(Number),
      // profile_id and user_id should come from original context, not overrides
      profile_id: "originalProfileId",
      user_id: "originalUserId",
      context: expect.objectContaining({
        profileId: "overriddenProfileId", // Context should have override
        userId: "originalUserId", // Original context preserved
        existingKey: "overriddenValue", // Override applied
        newKey: "newValue", // New key added
        _overridden: expect.stringContaining("existingKey: originalValue"), // Track overridden keys
        _newkeys: "newKey", // Track new keys (profileId is overridden, not new)
      }),
    });

    fetchSpy.mockRestore();
  });

  test("should handle deferred track without contextOverrides", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    const initializedSDK = getAnSDK(null);
    const decisionResponse = initializedSDK.getDeferredDecision({
      experimentId: PublishedExpId,
      seedId: "SomeSeed",
      context: {
        profileId: "testProfileId",
        userId: "testUserId",
      },
    });

    // Call deferred track without contextOverrides
    decisionResponse.track();

    // Wait for fetch to be called
    await waitFor(() => fetchSpy.mock.calls.length > 0);

    // Parse and verify the request payload
    const [url, options] = fetchSpy.mock.calls[0];
    const payload = JSON.parse(options!.body as string);

    expect(payload).toMatchObject({
      experiment_id: PublishedExpId,
      treatment_id: decisionResponse.decision.treatmentId, // Use actual treatment from decision
      seed_id: "SomeSeed",
      bucket: expect.any(Number),
      profile_id: "testProfileId",
      user_id: "testUserId",
      context: {
        profileId: "testProfileId",
        userId: "testUserId",
      },
    });

    // Should not have override tracking fields
    expect(payload.context._overridden).toBeUndefined();
    expect(payload.context._newkeys).toBeUndefined();

    fetchSpy.mockRestore();
  });
});
