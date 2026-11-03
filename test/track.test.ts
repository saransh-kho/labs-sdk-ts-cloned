import { DefaultTracer } from "../src/internal/default_tracer";
import { Tracer } from "../src/internal/tracer";
import { Tracker } from "../src/internal/tracker";
import { LabsTraceLevel } from "../src/types";

const testTracer = new Tracer(new DefaultTracer(), LabsTraceLevel.ERROR);

test(`Tracker correctly handles basic case`, async () => {
  let spy = jest.fn((url: string, request: Request) => {
    url;
    request;
    return Promise.resolve({
      json: () => Promise.resolve({ data: 100 }),
      ok: true,
    });
  });

  jest.spyOn(global, "fetch").mockImplementation(spy as jest.Mock);

  const tracker = new Tracker("http://snarf:8080/track");
  await tracker.track(
    {
      experimentId: "experimentId",
      seedId: "seedId",
      context: {
        profileId: "profileId",
        userId: "userId",
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
  );
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith("http://snarf:8080/track", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      experiment_id: "experimentId",
      treatment_id: "treatmentId",
      seed_id: "seedId",
      bucket: 99,
      profile_id: "profileId",
      user_id: "userId",
      policy_id: "policyId",
      context: {
        profileId: "profileId",
        userId: "userId",
      },
    }),
    signal: expect.any(AbortSignal),
  });
});

test(`Tracker correctly handles basic failure case`, async () => {
  let spy = jest.fn((url: string, request: Request) => {
    url;
    request;
    return Promise.resolve({
      json: () => Promise.resolve({ data: 100 }),
      ok: false,
    });
  });

  jest.spyOn(global, "fetch").mockImplementation(spy as jest.Mock);

  const tracker = new Tracker("http://snarf:8080/track");
  await tracker.track(
    {
      experimentId: "experimentId",
      seedId: "seedId",
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
    0xf00d,
    testTracer,
  );
  expect(spy).toHaveBeenCalledTimes(1);
});

test(`Tracker correctly handles throw case as error`, async () => {
  let spy = jest.fn((url: string, request: Request) => {
    url;
    request;
    throw new Error("fetch error");
  });

  jest.spyOn(global, "fetch").mockImplementation(spy as jest.Mock);

  const tracker = new Tracker("http://snarf:8080/track");
  await tracker.track(
    {
      experimentId: "experimentId",
      seedId: "seedId",
      context: {
        profileId: "profileId",
        userId: "userId",
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
    0x00f,
    testTracer,
  );
  expect(spy).toHaveBeenCalledTimes(1);
});

test(`Tracker correctly handles contextOverrides with new keys`, async () => {
  let spy = jest.fn((url: string, request: Request) => {
    url;
    request;
    return Promise.resolve({
      json: () => Promise.resolve({ data: 100 }),
      ok: true,
    });
  });

  jest.spyOn(global, "fetch").mockImplementation(spy as jest.Mock);

  const tracker = new Tracker("http://snarf:8080/track");
  await tracker.track(
    {
      experimentId: "experimentId",
      seedId: "seedId",
      context: {
        profileId: "profileId",
        userId: "userId",
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
    { newKey: "newValue", anotherKey: "anotherValue" },
  );

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith("http://snarf:8080/track", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      experiment_id: "experimentId",
      treatment_id: "treatmentId",
      seed_id: "seedId",
      bucket: 99,
      profile_id: "profileId",
      user_id: "userId",
      policy_id: "policyId",
      context: {
        profileId: "profileId",
        userId: "userId",
        newKey: "newValue",
        anotherKey: "anotherValue",
        _newkeys: "newKey, anotherKey",
      },
    }),
    signal: expect.any(AbortSignal),
  });
});

test(`Tracker correctly handles contextOverrides with overwritten keys`, async () => {
  let spy = jest.fn((url: string, request: Request) => {
    url;
    request;
    return Promise.resolve({
      json: () => Promise.resolve({ data: 100 }),
      ok: true,
    });
  });

  jest.spyOn(global, "fetch").mockImplementation(spy as jest.Mock);

  const tracker = new Tracker("http://snarf:8080/track");
  await tracker.track(
    {
      experimentId: "experimentId",
      seedId: "seedId",
      context: {
        profileId: "profileId",
        userId: "userId",
        existingKey: "originalValue",
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
    { existingKey: "overriddenValue", profileId: "overriddenProfileId" },
  );

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith("http://snarf:8080/track", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      experiment_id: "experimentId",
      treatment_id: "treatmentId",
      seed_id: "seedId",
      bucket: 99,
      profile_id: "profileId", // should still come from original context
      user_id: "userId", // should still come from original context
      policy_id: "policyId",
      context: {
        profileId: "overriddenProfileId",
        userId: "userId",
        existingKey: "overriddenValue",
        _overridden: "[existingKey: originalValue], [profileId: profileId]",
      },
    }),
    signal: expect.any(AbortSignal),
  });
});

test(`Tracker correctly handles contextOverrides when original context is undefined`, async () => {
  let spy = jest.fn((url: string, request: Request) => {
    url;
    request;
    return Promise.resolve({
      json: () => Promise.resolve({ data: 100 }),
      ok: true,
    });
  });

  jest.spyOn(global, "fetch").mockImplementation(spy as jest.Mock);

  const tracker = new Tracker("http://snarf:8080/track");
  await tracker.track(
    {
      experimentId: "experimentId",
      seedId: "seedId",
      // no context provided
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
    { newKey: "newValue", profileId: "overrideProfileId" },
  );

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith("http://snarf:8080/track", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      experiment_id: "experimentId",
      treatment_id: "treatmentId",
      seed_id: "seedId",
      bucket: 99,
      profile_id: undefined, // should be undefined since original context was undefined
      user_id: undefined, // should be undefined since original context was undefined
      policy_id: "policyId",
      context: {
        newKey: "newValue",
        profileId: "overrideProfileId",
        _newkeys: "newKey, profileId",
      },
    }),
    signal: expect.any(AbortSignal),
  });
});

test(`Tracker correctly handles no contextOverrides (existing behavior)`, async () => {
  let spy = jest.fn((url: string, request: Request) => {
    url;
    request;
    return Promise.resolve({
      json: () => Promise.resolve({ data: 100 }),
      ok: true,
    });
  });

  jest.spyOn(global, "fetch").mockImplementation(spy as jest.Mock);

  const tracker = new Tracker("http://snarf:8080/track");
  await tracker.track(
    {
      experimentId: "experimentId",
      seedId: "seedId",
      context: {
        profileId: "profileId",
        userId: "userId",
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
    // no contextOverrides provided
  );

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith("http://snarf:8080/track", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      experiment_id: "experimentId",
      treatment_id: "treatmentId",
      seed_id: "seedId",
      bucket: 99,
      profile_id: "profileId",
      user_id: "userId",
      policy_id: "policyId",
      context: {
        profileId: "profileId",
        userId: "userId",
      },
    }),
    signal: expect.any(AbortSignal),
  });
});
