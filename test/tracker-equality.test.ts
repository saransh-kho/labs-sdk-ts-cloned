import { Tracker } from "../src/internal/tracker";
import { DefaultTracer } from "../src/internal/default_tracer";
import { Tracer } from "../src/internal/tracer";
import { LabsTraceLevel } from "../src/types";

const testTracer = new Tracer(new DefaultTracer(), LabsTraceLevel.ERROR);

describe("Tracker with value equality", () => {
  test("should not track overrides when values are actually the same", async () => {
    const spy = jest.fn((url: string, request: Request) => {
      return Promise.resolve({
        json: () => Promise.resolve({ data: 100 }),
        ok: true,
      });
    });

    jest.spyOn(global, "fetch").mockImplementation(spy as jest.Mock);

    const tracker = new Tracker("http://test:8080/track");
    await tracker.track(
      {
        experimentId: "experimentId",
        seedId: "seedId",
        context: {
          profileId: "profileId",
          userId: "userId",
          tags: ["a", "b", "a"],
        },
      },
      {
        treatmentId: "treatmentId",
        policyId: "policyId",
        active: true,
        control: false,
        label: "T1",
        status: "success",
        experimentId: "experimentId",
      },
      99,
      testTracer,
      {
        // Same string value - should not be tracked as overridden
        profileId: "profileId",
        // Same array value (different order but same elements/counts) - should not be tracked
        tags: ["b", "a", "a"],
        // New key - should be tracked as new
        newKey: "newValue",
      },
    );

    expect(spy).toHaveBeenCalledTimes(1);

    const [url, options] = spy.mock.calls[0];
    const payload = JSON.parse(options!.body as unknown as string);

    expect(payload.context).toMatchObject({
      profileId: "profileId",
      userId: "userId",
      tags: ["b", "a", "a"],
      newKey: "newValue",
      _newkeys: "newKey", // Only newKey should be tracked as new
      // No _overridden field since no values actually changed
    });

    // Should not have _overridden since the values didn't actually change
    expect(payload.context._overridden).toBeUndefined();
  });

  test("should track overrides when values are actually different", async () => {
    const spy = jest.fn((url: string, request: Request) => {
      return Promise.resolve({
        json: () => Promise.resolve({ data: 100 }),
        ok: true,
      });
    });

    jest.spyOn(global, "fetch").mockImplementation(spy as jest.Mock);

    const tracker = new Tracker("http://test:8080/track");
    await tracker.track(
      {
        experimentId: "experimentId",
        seedId: "seedId",
        context: {
          profileId: "profileId",
          tags: ["a", "b", "a"],
        },
      },
      {
        treatmentId: "treatmentId",
        policyId: "policyId",
        active: true,
        control: false,
        label: "T1",
        status: "success",
        experimentId: "experimentId",
      },
      99,
      testTracer,
      {
        // Different string value - should be tracked as overridden
        profileId: "differentProfileId",
        // Different array value (different element counts) - should be tracked
        tags: ["a", "b", "b"],
      },
    );

    expect(spy).toHaveBeenCalledTimes(1);

    const [url, options] = spy.mock.calls[0];
    const payload = JSON.parse(options!.body as unknown as string);

    expect(payload.context).toMatchObject({
      profileId: "differentProfileId",
      tags: ["a", "b", "b"],
      _overridden: "[profileId: profileId], [tags: a,b,a]", // Both should be tracked as overridden
    });

    // Should not have _newkeys since no new keys were added
    expect(payload.context._newkeys).toBeUndefined();
  });
});
