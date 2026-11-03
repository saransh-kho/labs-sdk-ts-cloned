import * as _ from "lodash";
import {
  DecisionResponse,
  FeatureFlag,
  FlagDecisionRequest,
  FlagDecisionResponse,
  LabsTraceFields,
  LabsTraceLevel,
  TargetingRule,
} from "../src/types";
import {
  _internalFlagDecider as FlagDecider,
  _internalFlagDecisionService as FlagDecisionService,
  FlagDecisionMetadata,
  ResolveExperimentDecision,
} from "../src/flag-decision";
import { DecisionMetadata, _internalDecisionService as DecisionService } from "../src/decision";
import { UnpublishedExperimentFixture } from "./fixtures/experimentConfig";
import { DefaultTracer } from "../src/internal/default_tracer";
import { Tracer } from "../src/internal/tracer";

const testTracer = new Tracer(new DefaultTracer(), LabsTraceLevel.ERROR);

function duplicateFlag(flag: FeatureFlag): FeatureFlag {
  return _.cloneDeep(flag);
}

function legacyFlag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    uuid: "flag-1",
    key: "my-flag",
    projectId: "project-1",
    metadata: {
      status: true,
      schemaVersionNumber: 0,
      variants: [
        { uuid: "v1", name: "on", trafficPercentage: 50 },
        { uuid: "v2", name: "off", trafficPercentage: 50 },
      ],
    },
    ...overrides,
  };
}

function targetingFlag(rules: TargetingRule[], overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    uuid: "flag-2",
    key: "targeting-flag",
    projectId: "project-1",
    metadata: {
      status: true,
      schemaVersionNumber: 1,
      variants: [
        { uuid: "v-a", name: "A" },
        { uuid: "v-b", name: "B" },
      ],
    },
    targetingRules: rules,
    defaultRule: { variantKey: "A", enabled: true },
    ...overrides,
  };
}

function getDecider(
  flag: FeatureFlag | undefined,
  request: FlagDecisionRequest,
  resolveExperimentDecision?: ResolveExperimentDecision,
): FlagDecider {
  return new FlagDecider(flag, request, testTracer, resolveExperimentDecision);
}

function getFlagDecision(
  flag: FeatureFlag | undefined,
  request: FlagDecisionRequest,
  resolveExperimentDecision?: ResolveExperimentDecision,
) {
  const svc = new FlagDecisionService(resolveExperimentDecision);
  return svc.getFlagDecision(flag, request, testTracer);
}

describe("Legacy split (schemaVersionNumber === 0)", () => {
  test("disabled flag returns the default rule, inactive", async () => {
    const flag = legacyFlag({ metadata: { ...legacyFlag().metadata, status: false } });
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" });
    expect(decision.active).toBe(false);
    expect(decision.message).toContain("FF-OFF");
  });

  test("audience exclusion returns the default rule, inactive", async () => {
    const flag = legacyFlag({
      audienceGroup: [{ name: "us-only", value: { country: ["us"] } }],
    });
    const [decision] = await getDecision(flag, {
      flagId: flag.uuid,
      seedId: "s1",
      context: { country: "uk" },
    });
    expect(decision.active).toBe(false);
    expect(decision.message).toContain("FF-AUDIENCE");
  });

  test("audience satisfied proceeds to the traffic split", async () => {
    const flag = legacyFlag({
      audienceGroup: [{ name: "us-only", value: { country: ["us"] } }],
    });
    const [decision] = await getDecision(flag, {
      flagId: flag.uuid,
      seedId: "s1",
      context: { country: "us" },
    });
    expect(["on", "off"]).toContain(decision.variantKey);
    expect(decision.active).toBe(true);
  });

  test("zero variants yields a synthetic V1 decision, active matches flag status", async () => {
    const flag = legacyFlag({ metadata: { status: true, schemaVersionNumber: 0, variants: [] } });
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" });
    expect(decision.variantKey).toBe("V1");
    expect(decision.active).toBe(true);
    expect(decision.message).toContain("FF-NOVARIANT");
  });

  test("exactly one variant is always selected at 100%", async () => {
    const flag = legacyFlag({
      metadata: { status: true, schemaVersionNumber: 0, variants: [{ uuid: "v1", name: "only" }] },
    });
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" });
    expect(decision.variantKey).toBe("only");
    expect(decision.active).toBe(true);
    expect(decision.message).toContain("FF-ONEVARIANT");
  });

  test("whitelist match wins over the percentage split", async () => {
    const flag = legacyFlag({
      metadata: {
        status: true,
        schemaVersionNumber: 0,
        variants: [
          {
            uuid: "v1",
            name: "on",
            trafficPercentage: 1,
            whitelist: { items: { userId: { values: ["u1"] } } },
          },
          { uuid: "v2", name: "off", trafficPercentage: 99 },
        ],
      },
    });
    const [decision] = await getDecision(flag, {
      flagId: flag.uuid,
      seedId: "s1",
      context: { userId: "u1" },
    });
    expect(decision.variantKey).toBe("on");
    expect(decision.message).toContain("FF-ALLOW");
  });

  test("percentage split is deterministic for the same seed", async () => {
    const flagA = duplicateFlag(legacyFlag());
    const flagB = duplicateFlag(legacyFlag());
    const request: FlagDecisionRequest = { flagId: flagA.uuid, seedId: "consistent-seed" };
    const [a] = await getDecision(flagA, request);
    const [b] = await getDecision(flagB, request);
    expect(a).toEqual(b);
  });

  test("undefined flag returns an error-shaped empty response", async () => {
    const [decision] = await getDecision(undefined, { flagId: "missing", seedId: "s1" });
    expect(decision.message).toContain("undefined/missing");
    expect(decision.active).toBe(false);
  });
});

describe("Targeting rules (schemaVersionNumber > 0)", () => {
  test("TARGET_TO_PERCENTAGE at 100% weight always matches", async () => {
    const flag = targetingFlag([{ type: "TARGET_TO_PERCENTAGE", target: { variantKey: "A" } }]);
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" });
    expect(decision.variantKey).toBe("A");
    expect(decision.active).toBe(true);
  });

  test("TARGET_TO_PERCENTAGE out of rollout range is terminal (excluded), not a fall-through", async () => {
    const flag = targetingFlag([
      // weight: 0 guarantees every seed falls outside the [1, weight] rollout window.
      { type: "TARGET_TO_PERCENTAGE", target: { variantKey: "A", traffic: { weight: 0 } } },
      // A RANDOM_SPLIT after it must never run if rollout-exclude is terminal
      // rather than a fall-through - assert the decision does NOT come from here.
      { type: "RANDOM_SPLIT", targets: [{ variantKey: "B", traffic: { weight: 10000 } }] },
    ]);
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "any-seed" });
    expect(decision.variantKey).not.toBe("B");
    expect(decision.variantKey).toBe("A"); // from defaultRule, not the RANDOM_SPLIT rule after it
    expect(decision.message).toContain("FF-TARGETING-RULES-AUDIENCE-ROLLOUT_EXCLUDE");
  });

  test("TARGET_TO_AUDIENCE rule is skipped (falls through) when its own audienceGroup doesn't match", async () => {
    const flag = targetingFlag([
      {
        type: "TARGET_TO_AUDIENCE",
        audienceGroup: [{ name: "us-only", value: { country: ["us"] } }],
        target: { variantKey: "A" },
      },
      { type: "TARGET_TO_PERCENTAGE", target: { variantKey: "B" } },
    ]);
    const [decision] = await getDecision(flag, {
      flagId: flag.uuid,
      seedId: "s1",
      context: { country: "uk" },
    });
    expect(decision.variantKey).toBe("B");
  });

  test("RANDOM_SPLIT with no matching allocation swallows to fall-through (Java parity)", async () => {
    const flag = targetingFlag([
      // Targets sum to less than the total weight, so some seeds will find no match.
      { type: "RANDOM_SPLIT", targets: [{ variantKey: "A", traffic: { weight: 0 } }] },
      { type: "TARGET_TO_PERCENTAGE", target: { variantKey: "B" } },
    ]);
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" });
    expect(decision.variantKey).toBe("B");
  });

  test("rule list exhausted with no terminal decision falls back to defaultRule", async () => {
    const flag = targetingFlag([
      {
        type: "TARGET_TO_AUDIENCE",
        audienceGroup: [{ name: "x", value: { a: ["1"] } }],
        target: { variantKey: "A" },
      },
    ]);
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1", context: { a: "2" } });
    expect(decision.variantKey).toBe("A"); // from defaultRule
    expect(decision.message).toContain("FF-FALLBACK");
  });

  test("decisions are deterministic across two independent deciders given the same input", async () => {
    const rules: TargetingRule[] = [
      {
        type: "RANDOM_SPLIT",
        targets: [
          { variantKey: "A", traffic: { weight: 5000 } },
          { variantKey: "B", traffic: { weight: 5000 } },
        ],
      },
    ];
    const flagA = targetingFlag(rules);
    const flagB = targetingFlag(rules);
    const request: FlagDecisionRequest = { flagId: flagA.uuid, seedId: "consistent-seed" };
    const [a] = await getDecision(flagA, request);
    const [b] = await getDecision(flagB, request);
    expect(a).toEqual(b);
  });
});

describe("LINKED_EXPERIMENT", () => {
  function experimentDecisionOf(
    overrides: Partial<DecisionResponse>,
    metadata: Partial<DecisionMetadata> = {},
  ): [DecisionResponse, DecisionMetadata] {
    return [
      {
        experimentId: "exp-1",
        status: "success",
        active: true,
        control: false,
        treatmentId: "t1",
        label: "T1",
        ...overrides,
      },
      { bucket: 1, shouldTrack: true, ...metadata },
    ];
  }

  test("a mapped treatment serves the mapped variant's config as the treatment, tagged EXPERIMENT (Go/Java parity)", async () => {
    const flag = targetingFlag(
      [
        {
          type: "LINKED_EXPERIMENT",
          experimentId: "exp-1",
          linkedExperimentConfig: {
            onlyEnableRuleForExperimentAudience: false,
            treatmentMapping: { t1: { variantKey: "A" } },
          },
        },
      ],
      {
        metadata: {
          status: true,
          schemaVersionNumber: 1,
          variants: [
            { uuid: "v-a", name: "A", config: { from: "variant-a" } },
            { uuid: "v-b", name: "B" },
          ],
        },
      },
    );
    const resolve: ResolveExperimentDecision = async () =>
      experimentDecisionOf({ active: true, treatmentId: "t1", label: "T1", config: { from: "experiment" } });
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" }, resolve);
    expect(decision).toMatchObject({
      flagId: flag.uuid,
      variantId: "t1",
      variantKey: "T1",
      config: { from: "variant-a" },
      active: true,
      source: "EXPERIMENT",
    });
  });

  test("inactive experiment decision maps to EXPERIMENT:INACTIVE source", async () => {
    const flag = targetingFlag([
      {
        type: "LINKED_EXPERIMENT",
        experimentId: "exp-1",
        linkedExperimentConfig: {
          onlyEnableRuleForExperimentAudience: false,
          treatmentMapping: { t1: { variantKey: "A" } },
        },
      },
    ]);
    const resolve: ResolveExperimentDecision = async () =>
      experimentDecisionOf({ active: false, treatmentId: "t1" });
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" }, resolve);
    expect(decision.variantKey).toBe("T1");
    expect(decision.source).toBe("EXPERIMENT:INACTIVE");
  });

  test("experiment not found/errored falls through to the next rule", async () => {
    const flag = targetingFlag([
      {
        type: "LINKED_EXPERIMENT",
        experimentId: "does-not-exist",
        linkedExperimentConfig: { onlyEnableRuleForExperimentAudience: false, treatmentMapping: {} },
      },
      { type: "TARGET_TO_PERCENTAGE", target: { variantKey: "B" } },
    ]);
    const resolve: ResolveExperimentDecision = async () => [
      {
        experimentId: "does-not-exist",
        status: "error",
        active: false,
        control: true,
        treatmentId: "",
        label: "C",
      },
      { bucket: 0, shouldTrack: false },
    ];
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" }, resolve);
    expect(decision.variantKey).toBe("B");
  });

  test("an unpublished experiment falls through to the next rule (Go/Java parity)", async () => {
    const experiment = UnpublishedExperimentFixture;
    const flag = targetingFlag([
      {
        type: "LINKED_EXPERIMENT",
        experimentId: experiment.experiment_id,
        linkedExperimentConfig: {
          onlyEnableRuleForExperimentAudience: false,
          treatmentMapping: Object.fromEntries(
            experiment.treatment_ids.map((treatmentId) => [treatmentId, { variantKey: "A" }]),
          ),
        },
      },
      { type: "TARGET_TO_PERCENTAGE", target: { variantKey: "B" } },
    ]);
    const experiments = new DecisionService({ [experiment.experiment_id]: experiment });
    const resolve: ResolveExperimentDecision = async (request) =>
      experiments.getExperimentDecision(request, testTracer);

    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" }, resolve);

    expect(decision).toMatchObject({ variantKey: "B", source: "FEATURE" });
  });

  function audienceOnlyFlag(): FeatureFlag {
    return targetingFlag([
      {
        type: "LINKED_EXPERIMENT",
        experimentId: "exp-1",
        linkedExperimentConfig: {
          onlyEnableRuleForExperimentAudience: true,
          treatmentMapping: { t1: { variantKey: "A" } },
        },
      },
      { type: "TARGET_TO_PERCENTAGE", target: { variantKey: "B" } },
    ]);
  }

  test("onlyEnableRuleForExperimentAudience falls through when the experiment excludes the audience", async () => {
    const flag = audienceOnlyFlag();
    const resolve: ResolveExperimentDecision = async () =>
      experimentDecisionOf(
        { active: false, treatmentId: "t1", message: "EXP-AUDIENCE: Inactive due to audience control." },
        { exclusionCode: "EXP-AUDIENCE" },
      );
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" }, resolve);
    expect(decision.variantKey).toBe("B");
  });

  test("onlyEnableRuleForExperimentAudience reads the exclusion code, not the message text", async () => {
    const flag = audienceOnlyFlag();
    const resolve: ResolveExperimentDecision = async () =>
      experimentDecisionOf({ active: false, treatmentId: "t1", message: "Not an EXP-AUDIENCE exclusion" });
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" }, resolve);
    expect(decision.variantKey).toBe("T1");
    expect(decision.source).toBe("EXPERIMENT:INACTIVE");
  });

  test("onlyEnableRuleForExperimentAudience keeps an experiment decision inactive for another reason (Go/Java parity)", async () => {
    const flag = audienceOnlyFlag();
    const resolve: ResolveExperimentDecision = async () =>
      experimentDecisionOf({ active: false, treatmentId: "t1", message: "Inactive due to program holdout." });
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" }, resolve);
    expect(decision.variantKey).toBe("T1");
    expect(decision.source).toBe("EXPERIMENT:INACTIVE");
  });

  function mappedFlag(treatmentMapping: Record<string, { variantKey: string }>): FeatureFlag {
    return targetingFlag([
      {
        type: "LINKED_EXPERIMENT",
        experimentId: "exp-1",
        linkedExperimentConfig: { onlyEnableRuleForExperimentAudience: false, treatmentMapping },
      },
      { type: "TARGET_TO_PERCENTAGE", target: { variantKey: "B" } },
    ]);
  }

  test("missing treatment mapping serves the experiment's treatment and config (Go/Java parity)", async () => {
    const flag = mappedFlag({});
    const resolve: ResolveExperimentDecision = async () =>
      experimentDecisionOf({ active: true, treatmentId: "t1", label: "T1", config: { from: "experiment" } });
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" }, resolve);
    expect(decision).toMatchObject({
      variantId: "t1",
      variantKey: "T1",
      config: { from: "experiment" },
      active: true,
      source: "EXPERIMENT",
    });
  });

  test("mapped variant not present on the flag serves the experiment's treatment (Go/Java parity)", async () => {
    const flag = mappedFlag({ t1: { variantKey: "does-not-exist" } });
    const resolve: ResolveExperimentDecision = async () =>
      experimentDecisionOf({ active: true, treatmentId: "t1", label: "T1" });
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" }, resolve);
    expect(decision).toMatchObject({ variantId: "t1", variantKey: "T1", active: true, source: "EXPERIMENT" });
  });

  test("a treatment mapped to no variant turns the flag off (Go/Java parity)", async () => {
    const flag = mappedFlag({ t1: { variantKey: "" } });
    const resolve: ResolveExperimentDecision = async () =>
      experimentDecisionOf({ active: true, treatmentId: "t1", label: "T1", config: { from: "experiment" } });
    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" }, resolve);
    expect(decision).toMatchObject({ variantKey: "T1", active: false, source: "EXPERIMENT" });
    expect(decision.config).toBeUndefined();
  });
});

describe("Seed resolution", () => {
  test("no seed at all falls back to a random UUID rather than excluding (Go/Java parity)", async () => {
    const flag = legacyFlag();
    const [decision] = await getDecision(flag, { flagId: flag.uuid });
    expect(decision.seedType).toBe("NONE");
    expect(decision.seedId).toBeDefined();
    expect(decision.active).toBe(true); // never excluded, unlike experiments
  });

  test("preferredSeedId on the flag resolves from context", async () => {
    const flag = legacyFlag({ preferredSeedId: "USER_ID" });
    const [decision] = await getDecision(flag, {
      flagId: flag.uuid,
      context: { userId: "user-123" },
    });
    expect(decision.seedId).toBe("user-123");
    expect(decision.seedType).toBe("USER_ID");
  });

  test("an explicit seedId wins over the flag's seed type (Go/Java parity)", async () => {
    const flag = legacyFlag({ preferredSeedId: "USER_ID" });
    const [decision] = await getDecision(flag, {
      flagId: flag.uuid,
      seedId: "caller-seed",
      context: { userId: "user-123" },
    });
    expect(decision.seedId).toBe("caller-seed");
    expect(decision.seedType).toBe("SEED_ID");
  });
});

describe("FlagDecisionService", () => {
  test("stamps traceId onto the returned decision", async () => {
    const flag = legacyFlag();
    const [decision] = await getFlagDecision(flag, { flagId: flag.uuid, seedId: "s1" });
    expect(decision.traceId).toBeDefined();
  });
});

describe("shouldTrack metadata (auto-track parity with Go's TRACK_DECISION_TAG)", () => {
  test("is false when the flag is not tagged for tracking", async () => {
    const flag = legacyFlag({ tags: [] });
    const [, metadata] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" });
    expect(metadata.shouldTrack).toBe(false);
  });

  test("is true when the flag is tagged and the decision is active", async () => {
    const flag = legacyFlag({ tags: ["track_decision_response"] });
    const [decision, metadata] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" });
    expect(decision.active).toBe(true);
    expect(metadata.shouldTrack).toBe(true);
  });

  test("is false when the flag is tagged but the decision is inactive", async () => {
    const flag = legacyFlag({
      tags: ["track_decision_response"],
      metadata: { ...legacyFlag().metadata, status: false },
    });
    const [decision, metadata] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" });
    expect(decision.active).toBe(false);
    expect(metadata.shouldTrack).toBe(false);
  });
});

describe("Go parity", () => {
  // Buckets the Go SDK computes for flag "flag-2" (util.GetBucketForEntity + 1):
  // seed-1 -> 3836, seed-3 -> 1866, seed-5 -> 1311

  test("a disabled flag serves its default rule, inactive, without evaluating its rules", async () => {
    const flag = targetingFlag([{ type: "TARGET_TO_PERCENTAGE", target: { variantKey: "B" } }], {
      metadata: { ...targetingFlag([]).metadata, status: false },
    });

    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" });

    expect(decision).toMatchObject({
      variantKey: "A",
      active: false,
      message: "FF-OFF: Flag is not enabled",
    });
  });

  test("a rollout buckets on the flag and seed alone, like Go", async () => {
    const flag = targetingFlag([
      {
        ruleId: "rule-1",
        type: "TARGET_TO_PERCENTAGE",
        target: { variantKey: "B", traffic: { weight: 2000, allocations: [{ start: 1, end: 2000 }] } },
      },
    ]);

    const [inRollout] = await getDecision(flag, { flagId: flag.uuid, seedId: "seed-3" });
    const [outOfRollout] = await getDecision(flag, { flagId: flag.uuid, seedId: "seed-1" });

    expect(inRollout.variantKey).toBe("B");
    expect(outOfRollout.message).toContain("FF-TARGETING-RULES-AUDIENCE-ROLLOUT_EXCLUDE");
  });

  test("decision messages are Go's, numbered by the rule that decided", async () => {
    const flag = targetingFlag([
      {
        type: "TARGET_TO_AUDIENCE",
        audienceGroup: [{ name: "us-only", value: { country: ["us"] } }],
        target: { variantKey: "B" },
      },
      {
        type: "RANDOM_SPLIT",
        audienceGroup: [{ name: "uk-only", value: { country: ["uk"] } }],
        targets: [{ variantKey: "A", traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] } }],
      },
      {
        type: "TARGET_TO_PERCENTAGE",
        audienceGroup: [{ name: "fr-only", value: { country: ["fr"] } }],
        target: { variantKey: "B", traffic: { weight: 0, allocations: [] } },
      },
    ]);

    const messages = await Promise.all(
      ["us", "uk", "fr", "de"].map(async (country) => {
        const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1", context: { country } });
        return decision.message;
      }),
    );

    expect(messages).toEqual([
      "FF-TARGETING-RULES-AUDIENCE: RULE 1 part of audience and part of rollout",
      "FF-TARGETING-RULES-RANDOM-SPLIT: RULE 2 part of audience and split into variant",
      "FF-TARGETING-RULES-AUDIENCE-ROLLOUT_EXCLUDE: RULE 3 part of audience but excluded due to rollout",
      "FF-FALLBACK: Flag fell back to default rule",
    ]);
  });

  test("a linked experiment's decision carries the experiment's message, as in Go", async () => {
    const flag = targetingFlag([
      {
        type: "LINKED_EXPERIMENT",
        experimentId: "exp-1",
        linkedExperimentConfig: {
          onlyEnableRuleForExperimentAudience: false,
          treatmentMapping: { t1: { variantKey: "B" } },
        },
      },
    ]);
    const resolve: ResolveExperimentDecision = async () => [
      {
        experimentId: "exp-1",
        status: "success",
        active: false,
        control: true,
        treatmentId: "t1",
        label: "C",
        message: "Inactive due to program holdout.",
      },
      { bucket: 0, shouldTrack: false },
    ];

    const [decision] = await getDecision(flag, { flagId: flag.uuid, seedId: "s1" }, resolve);

    expect(decision.message).toBe("Inactive due to program holdout.");
  });

  test("a random split picks the target whose allocation holds the bucket, like Go", async () => {
    const flag = targetingFlag([
      {
        ruleId: "rule-1",
        type: "RANDOM_SPLIT",
        targets: [
          { variantKey: "A", traffic: { weight: 1000, allocations: [{ start: 3001, end: 4000 }] } },
          {
            variantKey: "B",
            traffic: {
              weight: 9000,
              allocations: [
                { start: 1, end: 3000 },
                { start: 4001, end: 10000 },
              ],
            },
          },
        ],
      },
    ]);

    const variants = await Promise.all(
      ["seed-1", "seed-3", "seed-5"].map(
        async (seedId) => (await getDecision(flag, { flagId: flag.uuid, seedId }))[0],
      ),
    );

    expect(variants.map(({ variantKey }) => variantKey)).toEqual(["A", "B", "B"]);
  });

  test("a linked experiment decides with the caller's seed, not the flag's", async () => {
    const flag = targetingFlag([
      {
        type: "LINKED_EXPERIMENT",
        experimentId: "exp-1",
        linkedExperimentConfig: { onlyEnableRuleForExperimentAudience: false, treatmentMapping: {} },
      },
    ]);
    const experimentSeeds: string[] = [];
    const resolve: ResolveExperimentDecision = async (request) => {
      experimentSeeds.push(request.seedId);
      return [
        {
          experimentId: "exp-1",
          status: "success",
          active: false,
          control: true,
          treatmentId: "",
          label: "C",
        },
        { bucket: 0, shouldTrack: false },
      ];
    };

    // The flag resolves its own seed from profileId; the experiment must not inherit it
    await getDecision(flag, { flagId: flag.uuid, context: { profileId: "profile-1" } }, resolve);
    await getDecision(flag, { flagId: flag.uuid, seedId: "caller-seed" }, resolve);

    expect(experimentSeeds).toEqual(["", "caller-seed"]);
  });
});

describe("Tracing", () => {
  type TraceLine = { level: LabsTraceLevel; id: string; message: string; fields: LabsTraceFields };

  async function traceDecision(
    flag: FeatureFlag,
    request: FlagDecisionRequest,
    resolveExperimentDecision?: ResolveExperimentDecision,
  ): Promise<TraceLine[]> {
    const lines: TraceLine[] = [];
    const tracer = new Tracer(
      {
        OnTrace: (level, _timestamp, id, message, fields) => lines.push({ level, id, message, fields }),
        flush: () => {},
      },
      LabsTraceLevel.INFO,
    );
    await new FlagDecider(flag, request, tracer, resolveExperimentDecision).getDecision();
    return lines;
  }

  function usOnlyRule(): TargetingRule {
    return {
      type: "TARGET_TO_AUDIENCE",
      audienceGroup: [{ name: "us-only", value: { country: ["us"] } }],
      target: { variantKey: "B" },
    };
  }

  test("names each skipped rule and the fallback to the default rule", async () => {
    const flag = targetingFlag([usOnlyRule(), usOnlyRule()]);

    const lines = await traceDecision(flag, { flagId: flag.uuid, seedId: "s1", context: { country: "uk" } });

    expect(lines.map(({ id, message }) => `${id}: ${message}`)).toEqual([
      "START: getFlagDecision starts",
      "FLAG_SEED_ID: Using the request's seedId",
      "FLAG_AUDIENCE_FAIL: context:'uk' fails check: country:'us'",
      "FLAG_RULE_SKIPPED: Rule 1 (TARGET_TO_AUDIENCE) skipped: audience not met",
      "FLAG_AUDIENCE_FAIL: context:'uk' fails check: country:'us'",
      "FLAG_RULE_SKIPPED: Rule 2 (TARGET_TO_AUDIENCE) skipped: audience not met",
      "FLAG_FALLBACK: No targeting rule produced a decision; serving the default rule",
      "END: getFlagDecision ends",
    ]);
  });

  test("tags a rule's audience lines with the rule they belong to", async () => {
    const flag = targetingFlag([usOnlyRule(), usOnlyRule()]);

    const lines = await traceDecision(flag, { flagId: flag.uuid, seedId: "s1", context: { country: "uk" } });

    expect(
      lines.filter(({ id }) => id === "FLAG_AUDIENCE_FAIL").map(({ fields }) => fields.ruleNumber),
    ).toEqual([1, 2]);
  });

  test("explains a linked experiment rule skipped for its audience", async () => {
    const flag = targetingFlag([
      {
        type: "LINKED_EXPERIMENT",
        experimentId: "exp-1",
        linkedExperimentConfig: { onlyEnableRuleForExperimentAudience: true, treatmentMapping: {} },
      },
    ]);
    const resolve: ResolveExperimentDecision = async () => [
      {
        experimentId: "exp-1",
        status: "success",
        active: false,
        control: true,
        treatmentId: "",
        label: "C",
        message: "EXP-AUDIENCE: Inactive due to audience control.",
      },
      { bucket: 0, shouldTrack: false, exclusionCode: "EXP-AUDIENCE" },
    ];

    const lines = await traceDecision(flag, { flagId: flag.uuid, seedId: "s1" }, resolve);

    expect(lines.map(({ message }) => message)).toContain(
      "Rule 1 (LINKED_EXPERIMENT) skipped: outside the linked experiment's audience",
    );
  });

  test("warns about a rule type the SDK does not support", async () => {
    const flag = targetingFlag([
      // A rule type added to the service after this SDK version
      { type: "TARGET_TO_SEGMENT" } as unknown as TargetingRule,
    ]);

    const lines = await traceDecision(flag, { flagId: flag.uuid, seedId: "s1" });

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: LabsTraceLevel.WARN, id: "FLAG_UNSUPPORTED_RULE" }),
        expect.objectContaining({ message: "Rule 1 (TARGET_TO_SEGMENT) skipped: unsupported rule type" }),
      ]),
    );
  });

  test("warns when no seed resolves and the decision uses a random seed", async () => {
    const flag = targetingFlag([{ type: "TARGET_TO_PERCENTAGE", target: { variantKey: "B" } }]);

    const lines = await traceDecision(flag, { flagId: flag.uuid });

    expect(lines).toContainEqual(
      expect.objectContaining({
        level: LabsTraceLevel.WARN,
        message: "No seed for type PROFILE_ID; using a random seed",
      }),
    );
  });

  test("reports the seed type a seed resolved from", async () => {
    const flag = targetingFlag([{ type: "TARGET_TO_PERCENTAGE", target: { variantKey: "B" } }], {
      preferredSeedId: "SESSION_ID",
    });

    const lines = await traceDecision(flag, { flagId: flag.uuid, context: { sessionId: "session-1" } });

    expect(lines).toContainEqual(
      expect.objectContaining({ level: LabsTraceLevel.INFO, message: "Resolved seed for type SESSION_ID" }),
    );
  });
});

async function getDecision(
  flag: FeatureFlag | undefined,
  request: FlagDecisionRequest,
  resolveExperimentDecision?: ResolveExperimentDecision,
): Promise<[FlagDecisionResponse, FlagDecisionMetadata]> {
  const decider = getDecider(flag, request, resolveExperimentDecision);
  return decider.getDecision();
}
