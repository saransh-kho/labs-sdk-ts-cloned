import * as sdk from "../src/sdk";
import { Tracker } from "../src/internal/tracker";
import { LabsDecisionTracer, LabsTraceFields, LabsTraceLevel, ExperimentConfiguration } from "../src/types";
import { PublishedExperimentFixture, SecondExperimentFixture } from "./fixtures/experimentConfig";
import { getAnSDK, getDeferredDecisionFromSDK } from "./test-utils";

jest.mock("../src/internal/tracker");

const PublishedExpId = PublishedExperimentFixture.experiment_id;
const SecondExpId = SecondExperimentFixture.experiment_id;

function programHoldoutFixtures(): { parent: ExperimentConfiguration; child: ExperimentConfiguration } {
  const parent: ExperimentConfiguration = {
    ...PublishedExperimentFixture,
    experiment_id: "parent-program",
    published: true,
    algorithm_type: "BASIC",
    experiment_type: "NON_CONTEXTUAL",
    is_program: true,
    control_treatment_id: "parent-control",
    default_treatment: "parent-control",
    traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
    treatments: [
      {
        treatment_id: "parent-control",
        title: "C",
        traffic_percentage: 0,
        traffic: { weight: 10000, allocations: [] },
      },
      {
        treatment_id: "parent-eligible",
        title: "T1",
        traffic_percentage: 0,
        traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
      },
    ],
  };
  const child: ExperimentConfiguration = {
    ...PublishedExperimentFixture,
    experiment_id: "child-exp",
    published: true,
    algorithm_type: "BASIC",
    parent_experiment_id: "parent-program",
    control_treatment_id: "child-c",
    default_treatment: "child-c",
    treatments: [
      { treatment_id: "child-t1", title: "T1", traffic_percentage: 100 },
      { treatment_id: "child-c", title: "C", traffic_percentage: 0 },
    ],
  };
  return { parent, child };
}

describe("getSDKVersion", () => {
  test("should return the correct SDK Version", () => {
    const actual = sdk.getSDKVersion();

    // Depends on rollup injection at build time. Can't really test output.
    expect(actual).toEqual("[VI]{version}[/VI]");
  });
});

describe("getDecision", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test("should return the decision", () => {
    const initializedSDK = getAnSDK(null);
    const decisionResponse = initializedSDK.getDecision({
      experimentId: PublishedExpId,
      seedId: "SomeSeed",
    });

    expect(decisionResponse).toMatchObject({
      experimentId: PublishedExpId,
      status: "success",
      control: false,
      treatmentId: "6fc0d6b1-fdbe-4007-bda9-e05c19592085",
      label: "T1",
      active: true,
    });
  });
});

describe("Program holdout parent tracking (Go parity, CD-62306)", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test("getDecision tracks the parent program once when deciding a child", () => {
    const trackSpy = jest.spyOn(Tracker.prototype, "track");
    const { parent, child } = programHoldoutFixtures();

    const sdkInstance = getAnSDK([child, parent]);
    sdkInstance.getDecision({
      experimentId: child.experiment_id,
      seedId: "program-seed",
    });

    const parentTracks = trackSpy.mock.calls.filter(([request]) => request.experimentId === "parent-program");
    const childTracks = trackSpy.mock.calls.filter(([request]) => request.experimentId === "child-exp");

    expect(parentTracks).toHaveLength(1);
    expect(childTracks).toHaveLength(1);
  });

  test("getDeferredDecision tracks the parent eagerly but defers the child", () => {
    const trackSpy = jest.spyOn(Tracker.prototype, "track");
    const { parent, child } = programHoldoutFixtures();

    const sdkInstance = getAnSDK([child, parent]);
    const deferred = sdkInstance.getDeferredDecision({
      experimentId: child.experiment_id,
      seedId: "program-seed",
    });

    expect(trackSpy).toHaveBeenCalledTimes(1);
    expect(trackSpy.mock.calls[0][0].experimentId).toBe("parent-program");

    deferred.track();
    expect(trackSpy).toHaveBeenCalledTimes(2);
    expect(trackSpy.mock.calls[1][0].experimentId).toBe("child-exp");
  });
});

describe("getDecisions", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test("should return the decisions", () => {
    const initializedSDK = getAnSDK([PublishedExperimentFixture, SecondExperimentFixture]);
    const decisionResponses = initializedSDK.getDecisions({
      experimentIds: [PublishedExpId, SecondExpId],
      seedId: "SomeSeed",
    });

    const expected = {
      decisions: [
        {
          experimentId: PublishedExpId,
          status: "success",
          control: false,
          treatmentId: "6fc0d6b1-fdbe-4007-bda9-e05c19592085",
          label: "T1",
          active: true,
        },
        {
          experimentId: SecondExpId,
          status: "success",
          control: false,
          treatmentId: "9623e656-4a77-498e-8289-a62145d9bd97",
          label: "CC",
          active: true,
        },
      ],
    };

    expect(decisionResponses).toMatchObject(expected);
  });
});

describe("getDeferredDecision", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test("should return the decision and onTrack callback function, do not trigger Track callback", () => {
    const trackSpy = jest.spyOn(Tracker.prototype, "track");
    const decisionResponse = getDeferredDecisionFromSDK();
    expect(typeof decisionResponse.track).toBe("function");
    expect(trackSpy).not.toHaveBeenCalled();
  });

  test("should return the decision and onTrack function, trigger Track callback from the response", () => {
    const trackSpy = jest.spyOn(Tracker.prototype, "track");
    const decisionResponse = getDeferredDecisionFromSDK();
    decisionResponse.track();
    expect(typeof decisionResponse.track).toBe("function");
    expect(trackSpy).toHaveBeenCalled();
  });

  test("should pass contextOverrides to track function correctly", () => {
    const trackSpy = jest.spyOn(Tracker.prototype, "track");
    const decisionResponse = getDeferredDecisionFromSDK({ foo: "bar" });

    const contextOverrides = {
      customKey: "customValue",
      anotherKey: "anotherValue",
    };

    decisionResponse.track(contextOverrides);

    expect(trackSpy).toHaveBeenCalledTimes(1);
    expect(trackSpy).toHaveBeenCalledWith(
      expect.any(Object), // DecisionRequest
      expect.objectContaining({
        experimentId: PublishedExpId,
        status: "success",
        active: true,
        control: false,
        label: "T1",
        treatmentId: "6fc0d6b1-fdbe-4007-bda9-e05c19592085",
      }), // DecisionResponse
      expect.any(Number), // bucket
      expect.any(Object), // tracer
      contextOverrides, // contextOverrides should be passed through
    );
  });
});

describe("getDeferredDecisions", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test("should return the deferred decisions", () => {
    const trackSpy = jest.spyOn(Tracker.prototype, "track");
    const initializedSDK = getAnSDK([PublishedExperimentFixture, SecondExperimentFixture]);
    const decisionResponses = initializedSDK.getDeferredDecisions({
      experimentIds: [PublishedExpId, SecondExpId],
      seedId: "SomeSeed",
    });

    const expectedDecisions = [
      {
        experimentId: PublishedExpId,
        status: "success",
        control: false,
        treatmentId: "6fc0d6b1-fdbe-4007-bda9-e05c19592085",
        label: "T1",
        active: true,
        seedId: "SomeSeed",
        seedType: "SEED_ID",
        traceId: expect.any(String),
      },
      {
        experimentId: SecondExpId,
        status: "success",
        control: false,
        treatmentId: "9623e656-4a77-498e-8289-a62145d9bd97",
        label: "CC",
        active: true,
        seedId: "SomeSeed",
        seedType: "SEED_ID",
        traceId: expect.any(String),
      },
    ];
    expect(decisionResponses.decisions).toMatchObject(expectedDecisions);

    const tracker = decisionResponses.track;
    expect(typeof tracker).toBe("function");

    tracker(SecondExpId);
    tracker(PublishedExpId);
    // tracked in opposite order, so make sure track() called with the matching decisions
    expect(trackSpy).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expectedDecisions[1],
      expect.any(Number),
      expect.any(Object),
      undefined,
    );
    expect(trackSpy).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expectedDecisions[0],
      expect.any(Number),
      expect.any(Object),
      undefined,
    );
  });
});

describe("setTraceListener", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  class TestTracer implements LabsDecisionTracer {
    traceCounts: Record<string, number> = {};
    OnTrace(
      level: LabsTraceLevel,
      timestamp: Date,
      id: string,
      message: string,
      fields: LabsTraceFields,
    ): void {
      level;
      timestamp;
      id;
      message;
      fields;

      const levelStr = LabsTraceLevel[level];
      this.traceCounts[levelStr] = (this.traceCounts[levelStr] || 0) + 1;
    }
    flush(): void {}
  }

  test("normal traces for regular old processing", () => {
    const initializedSDK = getAnSDK(null);
    const testTracer = new TestTracer();

    initializedSDK.setTraceListener(testTracer);
    initializedSDK.setTraceLevel(LabsTraceLevel.INFO);
    const decisionResponse = initializedSDK.getDecision({
      experimentId: PublishedExpId,
      seedId: "SomeSeed",
    });

    expect(testTracer.traceCounts["DEBUG"]).toBeUndefined(); // log level not set low enough
    expect(testTracer.traceCounts["ERROR"]).toBeUndefined(); // shouldn't be any
    expect(testTracer.traceCounts["UNKNOWN"]).toBeUndefined();
    expect(testTracer.traceCounts["SUPPRESS_TRACING"]).toBeUndefined();

    expect(testTracer.traceCounts["INFO"]).toBeGreaterThan(3); // > test to be resilient to tracing changes
    expect(testTracer.traceCounts["WARN"]).toBeGreaterThanOrEqual(1); // no context passed in

    expect(decisionResponse).toMatchObject({
      experimentId: PublishedExpId,
      status: "success",
      control: false,
      treatmentId: "6fc0d6b1-fdbe-4007-bda9-e05c19592085",
      label: "T1",
      active: true,
    });
  });

  test("debug info works", () => {
    const initializedSDK = getAnSDK(null);
    const testTracer = new TestTracer();

    initializedSDK.setTraceListener(testTracer);
    initializedSDK.setTraceLevel(LabsTraceLevel.DEBUG);

    const decisionResponse = initializedSDK.getDecision({
      experimentId: PublishedExpId,
      seedId: "SomeSeed",
    });

    expect(testTracer.traceCounts["ERROR"]).toBeUndefined(); // shouldn't be any
    expect(testTracer.traceCounts["UNKNOWN"]).toBeUndefined();
    expect(testTracer.traceCounts["SUPPRESS_TRACING"]).toBeUndefined();

    expect(testTracer.traceCounts["DEBUG"]).toBeGreaterThan(4); // > test to be resilient to tracing changes
    expect(testTracer.traceCounts["INFO"]).toBeGreaterThan(3); // > test to be resilient to tracing changes
    expect(testTracer.traceCounts["WARN"]).toBeGreaterThanOrEqual(1); // no context passed in

    expect(decisionResponse.treatmentId).toEqual("6fc0d6b1-fdbe-4007-bda9-e05c19592085");
  });

  test("errors works", () => {
    const initializedSDK = getAnSDK(null);
    const testTracer = new TestTracer();

    initializedSDK.setTraceListener(testTracer);
    initializedSDK.setTraceLevel(LabsTraceLevel.DEBUG);

    const decisionResponse = initializedSDK.getDecision({
      experimentId: "doesn't exist",
      seedId: "SomeSeed",
    });

    expect(testTracer.traceCounts["UNKNOWN"]).toBeUndefined();
    expect(testTracer.traceCounts["SUPPRESS_TRACING"]).toBeUndefined();
    expect(testTracer.traceCounts["WARN"]).toBeUndefined(); // no context passed in
    expect(testTracer.traceCounts["DEBUG"]).toBeUndefined(); // > test to be resilient to tracing changes

    expect(testTracer.traceCounts["ERROR"]).toBe(1);
    expect(testTracer.traceCounts["INFO"]).toBeGreaterThan(1); // > test to be resilient to tracing changes

    expect(decisionResponse.status).toStrictEqual("error");
  });
});
