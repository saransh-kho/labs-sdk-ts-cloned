import * as _ from "lodash";
import {
  AudienceGroup,
  DecisionRequest,
  DecisionResponse,
  ExperimentConfiguration,
  LabsTraceFields,
  LabsTraceLevel,
} from "../src/types";
import {
  _internalDecider as Decider,
  DecisionMetadata,
  _internalDecisionService as DecisionService,
} from "../src/decision";

import {
  UnpublishedExperimentFixture,
  PublishedExperimentFixture,
  PublishedExperimentFixtureWithPercentageTraffic,
  PublishedExperimentFixtureWithTrafficAllocation,
  PublishedExperimentFixtureInMEG,
  PublishedExperimentWithPolicyGroupFixture,
  PublishedExperimentRampUpWithPolicyGroupFixture,
} from "./fixtures/experimentConfig";
import { DefaultTracer } from "../src/internal/default_tracer";
import { Tracer } from "../src/internal/tracer";

function getEmptyConfig(): ExperimentConfiguration {
  const config: ExperimentConfiguration = {
    experiment_id: "EmptyExperiment",
    treatments: [],
    treatment_ids: [],
    experiment_type: "",
    algorithm_type: "",
    evaluation_order: undefined,
    total_enabled: false,
    is_feature: false,
    published: false,
    audience_group: [],
    num_of_unique_ctx_in_audience: 0,
    default_treatment: "",
  };
  return config;
}

// defined in 1 place so it can be changed for debugging test regressions

const testTracer = new Tracer(new DefaultTracer(), LabsTraceLevel.ERROR);

function duplicateConfig(config: ExperimentConfiguration): ExperimentConfiguration {
  return _.cloneDeep(config);
}

function getDecider(config: ExperimentConfiguration, request: DecisionRequest): Decider {
  return new Decider(config, request, testTracer);
}

function getExperimentDecision(
  config: ExperimentConfiguration,
  request: DecisionRequest,
): [DecisionResponse, DecisionMetadata] {
  const configs: Record<string, ExperimentConfiguration> = {};
  if (config !== undefined) {
    configs[config.experiment_id] = config;
  }

  const svc = new DecisionService(configs);
  return svc.getExperimentDecision(request, testTracer);
}

test("getExperimentDecision returns expected result with default config", () => {
  const decider = getDecider(duplicateConfig(PublishedExperimentFixture), {
    experimentId: "EmptyExperiment",
    seedId: "SomeSeed",
  });
  const [decision, metadata] = decider.getDecision();
  expect(metadata.bucket).toEqual(0);
  expect(metadata.shouldTrack).toEqual(false);
  expect(decision).toStrictEqual({
    experimentId: "",
    status: "error",
    active: false,
    control: true,
    label: "C",
    treatmentId: "",
    message: "Experiment ID request/cfg mismatch: fb95d807-1c86-4ea3-9d12-3a8a3db75daa, req: EmptyExperiment",
  });
});

test("getExperimentDecision returns expected result with fixture config", () => {
  const config = duplicateConfig(UnpublishedExperimentFixture);
  const [decision] = getExperimentDecision(config, {
    experimentId: config.experiment_id,
    seedId: "SomeSeed",
  });
  expect(decision).toMatchObject({
    experimentId: config.experiment_id,
    status: "success",
    active: false,
    control: true,
    label: "C",
    message: "experiment has not been activated/published",
    treatmentId: "85102379-695a-4c4d-8463-20f66343647e",
  });
});

test("ExperimentConfig fixture loaded ok", () => {
  expect(UnpublishedExperimentFixture).toBeDefined();
  expect(UnpublishedExperimentFixture.experiment_id === "fb95d807-1c86-4ea3-9d12-3a8a3db75daa");
  expect(
    duplicateConfig(UnpublishedExperimentFixture).experiment_id === "fb95d807-1c86-4ea3-9d12-3a8a3db75daa",
  );
});

test("DecisionService can be constructed and handles undefined seed", () => {
  const configA = duplicateConfig(PublishedExperimentFixture);
  const configB = duplicateConfig(PublishedExperimentFixture);

  const request: DecisionRequest = {
    experimentId: configA.experiment_id,
    seedId: "SomeSeedValue",
  };
  const deciderA = getDecider(configA, request);
  const deciderB = getDecider(configB, request);

  expect(deciderA).toBeDefined();
  // call _decide to get exceptions if something goes wrong
  const resultA = deciderA._decide();
  const resultB = deciderB._decide();

  // result should be deterministic and idempotent for same request info
  expect(resultA).toEqual(resultB);
});

test("DecisionService buckets published experiments", () => {
  const configA = duplicateConfig(PublishedExperimentFixture);
  const configB = duplicateConfig(PublishedExperimentFixture);
  expect(configA.published).toBeTruthy();

  const request: DecisionRequest = {
    experimentId: configA.experiment_id,
    seedId: "SomeSeedValue",
  };
  const deciderA = getDecider(configA, request);
  const deciderB = getDecider(configB, request);

  expect(deciderA).toBeDefined();
  // call _decide to get exceptions if something goes wrong
  const resultA = deciderA._decide();
  const resultB = deciderB._decide();

  // result should be deterministic and idempotent for same request info
  expect(resultA).toEqual(resultB);
});

test("undefined seedId causes decision exclusion", () => {
  const config = duplicateConfig(PublishedExperimentFixture);
  const request: DecisionRequest = {
    experimentId: config.experiment_id,
    seedId: undefined as unknown as string,
  };

  const [decision, metadata] = getExperimentDecision(config, request);
  // only 1 predictable field
  expect(decision.status).toEqual("success");
  expect(decision.active).toEqual(false);
  // Go parity: a request with no resolvable seed is excluded early with a typed
  // EXP-* code (previously surfaced late as a generic "no seed_id" message).
  expect(decision.message).toContain("required seed not present");
  expect(decision.message).toMatch(/^EXP-/);
  expect(metadata.shouldTrack).toEqual(false);
  expect(metadata.bucket).toEqual(0); // zero would be error in bucketing
});

describe("Handles edge cases errors", () => {
  [
    {
      field: "experiment_id",
      status: "error",
      message: "Experiment ID request/cfg mismatch: undefined, req: fb95d807-1c86-4ea3-9d12-3a8a3db75daa",
    },
    {
      // Go parity: no treatments/all-zero legacy traffic_percentage defaults the
      // total allocation to 100 rather than erroring, yielding a normal
      // inactive-due-to-traffic-allocation decision (see decision.test.ts
      // "legacy traffic_percentage summing to 0" below for the more direct case).
      // A bucket is now actually assigned (allocation space is 100, not 0).
      field: "treatments",
      status: "success",
      message: "Experiment fb95d807-1c86-4ea3-9d12-3a8a3db75daa is inactive due to traffic allocation.",
      expectBucket: false,
    },
    {
      // published===undefined (malformed config, distinct from an explicit
      // false) is still surfaced as an error status, unrelated to this fix.
      field: "published",
      status: "error",
      message: "experiment has not been activated/published",
    },
  ].forEach((t) => {
    test(`config missing required field: ${t.field}`, () => {
      const config = duplicateConfig(PublishedExperimentFixture);
      const request = {
        experimentId: config.experiment_id,
        seedId: "SomeSeedValue",
      };
      const configAny: LabsTraceFields = config;
      configAny[t.field as string] = undefined;
      const decider = getDecider(config, request);
      const [decision, metadata] = decider.getDecision();
      expect(decision).toEqual(
        expect.objectContaining({
          status: t.status,
          message: t.message,
        } as DecisionResponse),
      );
      if (t.expectBucket === false) {
        expect(metadata.bucket).toBeGreaterThan(0);
      } else {
        expect(metadata.bucket).toEqual(0);
      }
    });
  });

  test("helper methods handle edge case inputs", () => {
    const config = duplicateConfig(PublishedExperimentFixture);
    const request = {
      experimentId: config.experiment_id,
      seedId: "SomeSeedValue",
    };

    const decider = getDecider(config, request);
    expect(decider._isControlTreatment(undefined)).toBeFalsy();
    expect(() => {
      decider._getAllocationForRequest(-1, false);
    }).toThrowError("Total allocation space for experiment is <= 0");

    const configNoDefaultTreatment = duplicateConfig(PublishedExperimentFixture);
    delete configNoDefaultTreatment.default_treatment;
    const deciderNoDefaultTreatment = getDecider(configNoDefaultTreatment, request);
    const decision = deciderNoDefaultTreatment._getDefaultDecision();
    expect(decision.treatmentId).toStrictEqual("");

    // cleanly handle exception that are not typeof Error
    expect(() => {
      decider._handleError(23);
    }).not.toThrow();
  });

  test("does not surface a phantom treatment id when default/control is absent from treatments", () => {
    const request = { experimentId: "exp", seedId: "SomeSeedValue" };

    // Malformed config: default_treatment points at an id that isn't in the
    // treatments list, and there's no control_treatment_id to fall back to.
    // Go/Java hard-error here; TS should soft-fail with an empty id rather than
    // echoing back the dangling default_treatment id.
    const phantom = duplicateConfig(PublishedExperimentFixture);
    phantom.default_treatment = "does-not-exist";
    delete phantom.control_treatment_id;
    const phantomDecision = getDecider(phantom, request)._getDefaultDecision();
    expect(phantomDecision.treatmentId).toStrictEqual("");
    expect(phantomDecision.label).toStrictEqual("");

    // Sanity: a default_treatment that IS present in the treatments list is
    // still returned as-is (the tightening only affects dangling ids).
    const wellFormed = duplicateConfig(PublishedExperimentFixture);
    const realId = wellFormed.treatments![0].treatment_id;
    wellFormed.default_treatment = realId;
    const goodDecision = getDecider(wellFormed, request)._getDefaultDecision();
    expect(goodDecision.treatmentId).toStrictEqual(realId);
  });

  test("errors gracefully with undefined config and/or request", () => {
    const config = duplicateConfig(PublishedExperimentFixture);
    const request = {
      experimentId: config.experiment_id,
      seedId: "SomeSeedValue",
    };

    const Undefined = undefined as unknown;
    let [decision, metadata] = getExperimentDecision(Undefined as ExperimentConfiguration, request);

    expect(decision).toEqual(
      expect.objectContaining({
        status: "error",
        message: "Experiment configuration is undefined/missing",
      } as DecisionResponse),
    );

    const decider = getDecider(config, Undefined as DecisionRequest);
    decision = decider._decide();
    expect(decision).toEqual(
      expect.objectContaining({
        status: "error",
        message: "request parameter undefined",
      } as DecisionResponse),
    );
    expect(metadata.bucket).toEqual(0);
    expect(metadata.shouldTrack).toEqual(false);
  });

  test("Handles audience filtering", () => {
    const config = duplicateConfig(PublishedExperimentFixture);
    const audience_group: AudienceGroup = [
      {
        name: "My favorite rule",
        value: {
          color: ["blue", "purple"],
          country: ["us"],
          dog: ["collie"],
        },
      },
    ];
    config.audience_group = audience_group;
    const request: DecisionRequest = {
      experimentId: config.experiment_id,
      seedId: "SomeSeedValue",
      context: {
        boo: "ya", // does not match any audience
        color: "yellow",
        country: "us",
        dog: "collie",
      },
    };

    let [decision, metadata] = getExperimentDecision(config, request);
    expect(decision).toEqual(
      expect.objectContaining({
        status: "success",
        active: false,
        message: "EXP-AUDIENCE: Inactive due to audience control.",
      } as DecisionResponse),
    );
    expect(metadata.bucket).toEqual(0);
    expect(metadata.shouldTrack).toEqual(false);
    expect(metadata.exclusionCode).toEqual("EXP-AUDIENCE");

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    request!.context!.color = "purple";
    [decision, metadata] = getExperimentDecision(config, request);
    expect(decision).toEqual(
      expect.objectContaining({
        status: "success",
        active: true,
      } as DecisionResponse),
    );
    expect(metadata.bucket).toEqual(99);
    expect(metadata.shouldTrack).toEqual(true);
  });

  test("a decision carries its treatment's config, as in Go", () => {
    const config = duplicateConfig(PublishedExperimentFixture);
    config.treatments.forEach((treatment) => {
      treatment.config = { treatment: treatment.treatment_id };
    });

    const [decision] = getExperimentDecision(config, {
      experimentId: config.experiment_id,
      seedId: "SomeSeedValue",
    });

    expect(decision.active).toBe(true);
    expect(decision.config).toEqual({ treatment: decision.treatmentId });
  });

  test("an excluded decision carries its default treatment's config, as in Go", () => {
    const config = duplicateConfig(PublishedExperimentFixture);
    config.treatments.forEach((treatment) => {
      treatment.config = { treatment: treatment.treatment_id };
    });
    config.audience_group = [{ name: "Blue only", value: { color: ["blue"] } }];

    const [decision] = getExperimentDecision(config, {
      experimentId: config.experiment_id,
      seedId: "SomeSeedValue",
      context: { color: "yellow" },
    });

    expect(decision.active).toBe(false);
    expect(decision.treatmentId).not.toBe("");
    expect(decision.config).toEqual({ treatment: decision.treatmentId });
  });

  test("Fails Thompson Sampling", () => {
    const config = duplicateConfig(PublishedExperimentFixture);
    config.algorithm_type = "THOMPSON_SAMPLING";
    const request = {
      experimentId: config.experiment_id,
      seedId: "SomeSeedValue",
    };
    const [decision, metadata] = getExperimentDecision(config, request);
    expect(decision).toEqual(
      expect.objectContaining({
        status: "error",
        message: "THOMPSON_SAMPLING is not supported yet",
      } as DecisionResponse),
    );
    expect(metadata.bucket).toEqual(0);
    expect(metadata.shouldTrack).toEqual(false);
  });

  test("Go/Java parity: algorithm-type guard runs last, so audience exclusion wins over an unsupported algorithm_type", () => {
    const config = duplicateConfig(PublishedExperimentFixture);
    config.algorithm_type = "THOMPSON_SAMPLING";
    config.audience_group = [
      {
        name: "My favorite rule",
        value: { color: ["blue", "purple"] },
      },
    ];
    const request: DecisionRequest = {
      experimentId: config.experiment_id,
      seedId: "SomeSeedValue",
      context: { color: "yellow" }, // does not match the audience group
    };
    const [decision, metadata] = getExperimentDecision(config, request);
    // Previously this would have thrown "THOMPSON_SAMPLING is not supported
    // yet" since the algorithm guard ran before audience filtering.
    expect(decision).toEqual(
      expect.objectContaining({
        status: "success",
        active: false,
        message: "EXP-AUDIENCE: Inactive due to audience control.",
      } as DecisionResponse),
    );
    expect(metadata.bucket).toEqual(0);
  });

  test("Go parity: legacy traffic_percentage summing to 0 defaults total allocation to 100 instead of erroring", () => {
    const config = duplicateConfig(PublishedExperimentFixture);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    config.treatments!.forEach((t) => (t.traffic_percentage = 0));
    const request = {
      experimentId: config.experiment_id,
      seedId: "SomeSeedValue",
    };
    const [decision, metadata] = getExperimentDecision(config, request);
    expect(decision).toEqual(
      expect.objectContaining({
        status: "success",
        active: false,
        message: "Experiment fb95d807-1c86-4ea3-9d12-3a8a3db75daa is inactive due to traffic allocation.",
      } as DecisionResponse),
    );
    expect(metadata.bucket).toBeGreaterThan(0);
    expect(metadata.shouldTrack).toEqual(false);
  });
});

describe("Decision Service - traffic allocation use cases", () => {
  [
    {
      useCase: "returns exclude decision if request is not part of the allocated traffic",
      config: duplicateConfig(PublishedExperimentFixtureWithPercentageTraffic),
      active: false,
      seedId: "SomeSeedValue",
      message: "Experiment fb95d807-1c86-4ea3-9d12-3a8a3db75daa is inactive due to traffic allocation.",
    },
    {
      useCase: "returns decision if request is part of the allocated traffic",
      config: duplicateConfig(PublishedExperimentFixtureWithPercentageTraffic),
      active: true,
      seedId: "test123",
      message: undefined,
    },
    {
      useCase: "returns exclude decision if request is not part of MEG",
      config: duplicateConfig(PublishedExperimentFixtureInMEG),
      active: false,
      seedId: "SomeSeedValue",
      message:
        "Experiment fb95d807-1c86-4ea3-9d12-3a8a3db75daa is inactive because request is not part of Mutually Exclusive Group.",
    },
    {
      useCase: "returns decision if request is part of MEG",
      config: duplicateConfig(PublishedExperimentFixtureInMEG),
      active: true,
      seedId: "test123",
      message: undefined,
    },
  ].forEach((t) => {
    test(`DecisionService: ${t.useCase}`, () => {
      const request: DecisionRequest = {
        experimentId: t.config.experiment_id,
        seedId: t.seedId,
      };
      const deciderA = getDecider(t.config, request);

      expect(deciderA).toBeDefined();
      // call _decide to get exceptions if something goes wrong
      const resultA = deciderA._decide();
      expect(resultA.status).toEqual("success");
      expect(resultA.active).toEqual(t.active);
      expect(resultA.message).toEqual(t.message);
    });
  });

  test("DecisionService handles policy groups", () => {
    const config = duplicateConfig(PublishedExperimentWithPolicyGroupFixture);
    const request: DecisionRequest = {
      experimentId: config.experiment_id,
      seedId: "TestSeedId1",
      context: {
        sessionId: "someSessionValue",
      },
    };
    const decider = getDecider(config, request);
    expect(decider).toBeDefined();
    const result = decider._decide();
    expect(result.active).toEqual(true);
  });

  test("DecisionService handles policy groups with traffic ramp-up", () => {
    const configA = duplicateConfig(PublishedExperimentWithPolicyGroupFixture);
    const configB = duplicateConfig(PublishedExperimentRampUpWithPolicyGroupFixture);

    const request: DecisionRequest = {
      experimentId: configA.experiment_id,
      seedId: "TestSeedId1",
    };
    const deciderA = getDecider(configA, request);
    const deciderB = getDecider(configB, request);

    expect(deciderA).toBeDefined();
    // call _decide to get exceptions if something goes wrong
    const resultA = deciderA._decide();
    const resultB = deciderB._decide();

    // result should be deterministic and idempotent for same request info
    expect(resultA).toEqual(resultB);
  });

  test("DecisionService handles new traffic allocations", () => {
    const configA = duplicateConfig(PublishedExperimentFixtureWithTrafficAllocation);
    const configB = duplicateConfig(PublishedExperimentFixtureWithTrafficAllocation);

    const request: DecisionRequest = {
      experimentId: configA.experiment_id,
      seedId: "SomeSeedValue",
    };
    const deciderA = getDecider(configA, request);
    const deciderB = getDecider(configB, request);

    expect(deciderA).toBeDefined();
    // call _decide to get exceptions if something goes wrong
    const resultA = deciderA._decide();
    const resultB = deciderB._decide();

    // result should be deterministic and idempotent for same request info
    expect(resultA).toEqual(resultB);
  });
});

describe("Program holdout and control treatment (Go parity)", () => {
  function programConfigs(options: {
    parentControlAllocations: { start: number; end: number }[];
    parentEligibleAllocations?: { start: number; end: number }[];
  }): {
    child: ExperimentConfiguration;
    parent: ExperimentConfiguration;
  } {
    const parentEligibleAllocations = options.parentEligibleAllocations ?? [];
    const parent: ExperimentConfiguration = {
      ...getEmptyConfig(),
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
          traffic: { weight: 10000, allocations: options.parentControlAllocations },
        },
        {
          treatment_id: "parent-eligible",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: parentEligibleAllocations },
        },
      ],
    };
    const child: ExperimentConfiguration = {
      ...getEmptyConfig(),
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
    return { child, parent };
  }

  function decideChild(
    child: ExperimentConfiguration,
    parent?: ExperimentConfiguration,
    seedId = "holdout-seed",
  ): [DecisionResponse, DecisionMetadata] {
    const configs: Record<string, ExperimentConfiguration> = {
      [child.experiment_id]: child,
    };
    if (parent) {
      configs[parent.experiment_id] = parent;
    }
    const svc = new DecisionService(configs);
    return svc.getExperimentDecision({ experimentId: child.experiment_id, seedId }, testTracer);
  }

  test("child is held out when the parent assigns control", () => {
    const { child, parent } = programConfigs({
      parentControlAllocations: [{ start: 1, end: 10000 }],
    });
    const [decision] = decideChild(child, parent);
    expect(decision.active).toBe(false);
    expect(decision.control).toBe(true);
    expect(decision.message).toContain("program holdout");
  });

  test("child proceeds when the parent assigns a non-control treatment", () => {
    const { child, parent } = programConfigs({
      parentControlAllocations: [],
      parentEligibleAllocations: [{ start: 1, end: 10000 }],
    });
    const [decision] = decideChild(child, parent);
    expect(decision.active).toBe(true);
    expect(decision.treatmentId).toBe("child-t1");
  });

  test("holdout fails closed when the parent program config is not supplied", () => {
    const { child } = programConfigs({ parentControlAllocations: [] });
    const [decision] = decideChild(child);
    expect(decision.active).toBe(false);
    expect(decision.message).toContain("program holdout");
  });

  test("program holdout records parent decision metadata for tracking", () => {
    const { child, parent } = programConfigs({
      parentControlAllocations: [],
      parentEligibleAllocations: [{ start: 1, end: 10000 }],
    });
    const [, metadata] = decideChild(child, parent);
    expect(metadata.programParent).toBeDefined();
    expect(metadata.programParent?.request.experimentId).toBe("parent-program");
    expect(metadata.programParent?.decision.active).toBe(true);
    expect(metadata.programParent?.metadata.shouldTrack).toBe(true);
  });

  test("control_treatment_id sets the control flag without a 'C' title", () => {
    const config: ExperimentConfiguration = {
      ...getEmptyConfig(),
      experiment_id: "ctl-exp",
      published: true,
      algorithm_type: "BASIC",
      control_treatment_id: "the-control",
      default_treatment: "the-control",
      treatments: [{ treatment_id: "the-control", title: "Control Variant", traffic_percentage: 100 }],
    };
    const svc = new DecisionService({ [config.experiment_id]: config });
    const [decision] = svc.getExperimentDecision(
      { experimentId: config.experiment_id, seedId: "s" },
      testTracer,
    );
    expect(decision.treatmentId).toBe("the-control");
    expect(decision.control).toBe(true);
  });
});

describe("Seed resolution (item 10, Go parity)", () => {
  function publishedConfig(overrides: Partial<ExperimentConfiguration>): ExperimentConfiguration {
    return {
      ...getEmptyConfig(),
      experiment_id: "seed-exp",
      published: true,
      algorithm_type: "BASIC",
      default_treatment: "t1",
      control_treatment_id: "c1",
      treatments: [
        { treatment_id: "t1", title: "T1", traffic_percentage: 100 },
        { treatment_id: "c1", title: "C", traffic_percentage: 0 },
      ],
      ...overrides,
    };
  }

  function decide(config: ExperimentConfiguration, request: Partial<DecisionRequest>): DecisionResponse {
    const svc = new DecisionService({ [config.experiment_id]: config });
    const [decision] = svc.getExperimentDecision(
      { experimentId: config.experiment_id, seedId: "", ...request },
      testTracer,
    );
    return decision;
  }

  test("PROFILE_ID seed resolves from context and is stamped on the response", () => {
    const config = publishedConfig({ default_seed_id: "PROFILE_ID" });
    const decision = decide(config, { context: { profileId: "p-123" } });
    expect(decision.active).toBe(true);
    expect(decision.seedId).toBe("p-123");
    expect(decision.seedType).toBe("PROFILE_ID");
  });

  test("request-level profileId is used (merged into context) and stamped", () => {
    const config = publishedConfig({ default_seed_id: "PROFILE_ID" });
    const decision = decide(config, { profileId: "req-profile" });
    expect(decision.active).toBe(true);
    expect(decision.seedId).toBe("req-profile");
    expect(decision.seedType).toBe("PROFILE_ID");
  });

  test("missing typed seed falls back to the request seedId (no exclusion)", () => {
    const config = publishedConfig({ default_seed_id: "PROFILE_ID" });
    const decision = decide(config, { seedId: "fallback-seed" }); // no profileId
    expect(decision.active).toBe(true);
    expect(decision.seedId).toBe("fallback-seed");
    expect(decision.seedType).toBe("SEED_ID");
  });

  test("no seed at all excludes early with a typed EXP-* code", () => {
    const config = publishedConfig({ default_seed_id: "PROFILE_ID" });
    const decision = decide(config, { seedId: "" }); // no profileId, no seedId
    expect(decision.active).toBe(false);
    expect(decision.message).toContain("EXP-NOPROFILEID");
    expect(decision.seedType).toBe("NONE");
  });

  test("MAB excludes when the override seed cannot be resolved (no UUID fallback)", () => {
    const config = publishedConfig({
      default_seed_id: "PROFILE_ID",
      policy_groups: [
        {
          policy_id: "pg1",
          name: "PG1",
          override_seed_id: "SESSION_ID",
          algorithm_type: "BASIC",
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
          treatment_allocations: [{ treatment_id: "t1", traffic: { weight: 10000 } }],
        },
      ],
    });
    // Main seed resolves (profileId), but the policy override seed type
    // (SESSION_ID) has no value and there is no request seedId fallback.
    const decision = decide(config, { context: { profileId: "p-123" } });
    expect(decision.active).toBe(false);
  });
});
