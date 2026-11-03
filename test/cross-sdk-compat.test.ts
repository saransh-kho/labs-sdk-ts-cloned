// Cross-SDK compatibility check: these expected values are NOT derived from
// reading/reasoning about this TS implementation. They were captured by
// actually executing java-labs-sdk's real decision engine
// (ExperimentDecisionResolverImpl - the same "legacy"/BYOC-cache resolver
// class real Java partners use, requiring no network) against the identical
// scenario definitions below, via a standalone Maven harness (built locally
// against `com.wbdstreaming.labs:labs-sdk:DEV-SNAPSHOT`, JDK 17). This test
// only asserts the fields that are meaningfully comparable across both SDKs'
// public DecisionResponse shapes: active, control, treatmentId, label.
//
// To regenerate/re-verify the Java side:
//   1. `mvn -pl labs-sdk -am install -DskipTests` in java-labs-sdk (JDK 17)
//   2. Build a small Maven project depending on that artifact + gson + caffeine,
//      with a main() that constructs a Caffeine cache pre-populated with the
//      scenario's ExperimentConfiguration, calls
//      `new ExperimentDecisionResolverImpl(cache, noopHttpClient).resolve(request)`,
//      and prints active/control/treatmentId/label as JSON.
//   3. Feed it the same scenario shapes as below (translated into Java's
//      Map<String,Treatment>-keyed ExperimentConfiguration record) and diff.
//
// Known, expected, documented non-comparable areas (not tested here):
//   - TS's legacy `traffic_percentage` model has no Java equivalent at all -
//     java-labs-sdk's Treatment record only has the traffic-allocations
//     model. All scenarios below use that shared allocations model on both
//     sides so the comparison is meaningful.
//   - Java's `resolve()` THROWS for an unsupported algorithm_type
//     (UnsupportedOperationException escapes to the caller); TS's public
//     getDecision() never throws, it catches internally and returns an
//     error-status DecisionResponse. This is a deliberate, documented
//     interface difference, not a bug - what this test verifies instead is
//     that the ORDERING is the same on both sides (audience/holdout/MEG
//     exclusions still win over an unsupported algorithm type, in both SDKs),
//     which is the thing Part A's fix was actually about.
//   - Exact message/code string wording is not compared (different taxonomies
//     - Java uses a ResponseCode enum, TS uses free-text messages) - only the
//     decision *outcome* (active/control/treatment) is asserted.
import { _internalDecisionService as DecisionService, DecisionMetadata } from "../src/decision";
import { DecisionRequest, DecisionResponse, ExperimentConfiguration, LabsTraceLevel } from "../src/types";
import { Tracer } from "../src/internal/tracer";
import { DefaultTracer } from "../src/internal/default_tracer";

const testTracer = new Tracer(new DefaultTracer(), LabsTraceLevel.SUPPRESS_TRACING);

type ComparableDecision = { active: boolean; control: boolean; treatmentId: string; label: string };

function decide(
  config: ExperimentConfiguration,
  parent: ExperimentConfiguration | undefined,
  request: DecisionRequest,
): [ComparableDecision, DecisionResponse, DecisionMetadata] {
  const configs: Record<string, ExperimentConfiguration> = { [config.experiment_id]: config };
  if (parent) {
    configs[parent.experiment_id] = parent;
  }
  const svc = new DecisionService(configs);
  const [decision, metadata] = svc.getExperimentDecision(request, testTracer);
  return [
    {
      active: decision.active,
      control: decision.control,
      treatmentId: decision.treatmentId,
      label: decision.label,
    },
    decision,
    metadata,
  ];
}

// traffic:{weight:10000} at the experiment level opts TS into the shared
// allocations-based split model (matching what Java always uses) instead of
// the legacy traffic_percentage-summing model Java has no equivalent of.
function baseExp(overrides: Partial<ExperimentConfiguration>): ExperimentConfiguration {
  return {
    experiment_id: "exp-1",
    treatments: [],
    treatment_ids: [],
    experiment_type: "",
    algorithm_type: "BASIC",
    total_enabled: false,
    is_feature: false,
    published: true,
    traffic: { weight: 10000 },
    ...overrides,
  };
}

describe("cross-SDK compat: real java-labs-sdk output vs labs-sdk-ts", () => {
  test("basic-split-seedA: two even treatments, seed lands in the second half", () => {
    const exp = baseExp({
      default_treatment: "c1",
      control_treatment_id: "c1",
      treatments: [
        {
          treatment_id: "t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 5000, allocations: [{ start: 1, end: 5000 }] },
        },
        {
          treatment_id: "c1",
          title: "C",
          traffic_percentage: 0,
          traffic: { weight: 5000, allocations: [{ start: 5001, end: 10000 }] },
        },
      ],
    });
    const [result] = decide(exp, undefined, { experimentId: "exp-1", seedId: "seed-A" });
    // Captured from real java-labs-sdk: active=true, control=true, treatmentId=c1, label=C
    expect(result).toEqual({
      active: true,
      control: true,
      treatmentId: "c1",
      label: "C",
    } as ComparableDecision);
  });

  test("basic-split-seedB: same experiment, different seed lands in the first half", () => {
    const exp = baseExp({
      default_treatment: "c1",
      control_treatment_id: "c1",
      treatments: [
        {
          treatment_id: "t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 5000, allocations: [{ start: 1, end: 5000 }] },
        },
        {
          treatment_id: "c1",
          title: "C",
          traffic_percentage: 0,
          traffic: { weight: 5000, allocations: [{ start: 5001, end: 10000 }] },
        },
      ],
    });
    const [result] = decide(exp, undefined, { experimentId: "exp-1", seedId: "seed-B" });
    // Captured from real java-labs-sdk: active=true, control=false, treatmentId=t1, label=T1
    expect(result).toEqual({
      active: true,
      control: false,
      treatmentId: "t1",
      label: "T1",
    } as ComparableDecision);
  });

  test("three uneven treatments (EPSILON_FIRST) resolve to the same treatment as Java", () => {
    const exp = baseExp({
      algorithm_type: "EPSILON_FIRST",
      default_treatment: "c1",
      control_treatment_id: "c1",
      treatments: [
        {
          treatment_id: "t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 3000, allocations: [{ start: 1, end: 3000 }] },
        },
        {
          treatment_id: "t2",
          title: "T2",
          traffic_percentage: 0,
          traffic: { weight: 3000, allocations: [{ start: 3001, end: 6000 }] },
        },
        {
          treatment_id: "c1",
          title: "C",
          traffic_percentage: 0,
          traffic: { weight: 4000, allocations: [{ start: 6001, end: 10000 }] },
        },
      ],
    });
    const [result] = decide(exp, undefined, {
      experimentId: "exp-1",
      seedId: "user-42",
      context: { profileId: "user-42" },
    });
    // Captured from real java-labs-sdk: active=true, control=false, treatmentId=t2, label=T2
    expect(result).toEqual({
      active: true,
      control: false,
      treatmentId: "t2",
      label: "T2",
    } as ComparableDecision);
  });

  test("audience value-match rule includes the request", () => {
    const exp = baseExp({
      default_treatment: "c1",
      control_treatment_id: "c1",
      audience_group: [{ name: "us-only", value: { country: ["us"] } }],
      treatments: [
        {
          treatment_id: "t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
        },
        { treatment_id: "c1", title: "C", traffic_percentage: 0, traffic: { weight: 0 } },
      ],
    });
    const [result] = decide(exp, undefined, {
      experimentId: "exp-1",
      seedId: "s1",
      context: { country: "us" },
    });
    // Captured from real java-labs-sdk: active=true, control=false, treatmentId=t1, label=T1
    expect(result).toEqual({
      active: true,
      control: false,
      treatmentId: "t1",
      label: "T1",
    } as ComparableDecision);
  });

  test("audience value-match rule excludes a non-matching request", () => {
    const exp = baseExp({
      default_treatment: "c1",
      control_treatment_id: "c1",
      audience_group: [{ name: "us-only", value: { country: ["us"] } }],
      treatments: [
        {
          treatment_id: "t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
        },
        { treatment_id: "c1", title: "C", traffic_percentage: 0, traffic: { weight: 0 } },
      ],
    });
    const [result] = decide(exp, undefined, {
      experimentId: "exp-1",
      seedId: "s1",
      context: { country: "uk" },
    });
    // Captured from real java-labs-sdk: active=false, control=true, treatmentId=c1, label=C
    expect(result).toEqual({
      active: false,
      control: true,
      treatmentId: "c1",
      label: "C",
    } as ComparableDecision);
  });

  test("audience jsonlogic query (semver_cmp + icase_compare) matches, same as Java", () => {
    const exp = baseExp({
      default_treatment: "c1",
      control_treatment_id: "c1",
      audience_group: [
        {
          name: "ios-recent",
          value: {},
          query:
            '{"and":[{"icase_compare":["==",{"var":"platform"},"ios"]},{"semver_cmp":[">=",{"var":"appVersion"},"18.6"]}]}',
        },
      ],
      treatments: [
        {
          treatment_id: "t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
        },
        { treatment_id: "c1", title: "C", traffic_percentage: 0, traffic: { weight: 0 } },
      ],
    });
    const [result] = decide(exp, undefined, {
      experimentId: "exp-1",
      seedId: "s1",
      context: { platform: "ios", appVersion: "18.6.1" },
    });
    // Captured from real java-labs-sdk: active=true, control=false, treatmentId=t1, label=T1
    expect(result).toEqual({
      active: true,
      control: false,
      treatmentId: "t1",
      label: "T1",
    } as ComparableDecision);
  });

  test("audience jsonlogic query does not match an older app version, same as Java", () => {
    const exp = baseExp({
      default_treatment: "c1",
      control_treatment_id: "c1",
      audience_group: [
        {
          name: "ios-recent",
          value: {},
          query:
            '{"and":[{"icase_compare":["==",{"var":"platform"},"ios"]},{"semver_cmp":[">=",{"var":"appVersion"},"18.6"]}]}',
        },
      ],
      treatments: [
        {
          treatment_id: "t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
        },
        { treatment_id: "c1", title: "C", traffic_percentage: 0, traffic: { weight: 0 } },
      ],
    });
    const [result] = decide(exp, undefined, {
      experimentId: "exp-1",
      seedId: "s1",
      context: { platform: "ios", appVersion: "17.0.0" },
    });
    // Captured from real java-labs-sdk: active=false, control=true, treatmentId=c1, label=C
    expect(result).toEqual({
      active: false,
      control: true,
      treatmentId: "c1",
      label: "C",
    } as ComparableDecision);
  });

  test("allow-list override wins over the traffic split, same treatment as Java", () => {
    const exp = baseExp({
      default_treatment: "c1",
      control_treatment_id: "c1",
      treatments: [
        {
          treatment_id: "t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 0 },
          whitelist: { items: { userId: { values: ["vip-1"] } } },
        },
        {
          treatment_id: "c1",
          title: "C",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
        },
      ],
    });
    const [result] = decide(exp, undefined, {
      experimentId: "exp-1",
      seedId: "s1",
      context: { userId: "vip-1" },
    });
    // Captured from real java-labs-sdk: active=true, control=false, treatmentId=t1, label=T1
    expect(result).toEqual({
      active: true,
      control: false,
      treatmentId: "t1",
      label: "T1",
    } as ComparableDecision);
  });

  test("MEG (mutually exclusive group) excludes a seed outside the group's allocation, same as Java", () => {
    const exp = baseExp({
      default_treatment: "c1",
      control_treatment_id: "c1",
      group_id: "group-1",
      traffic: { weight: 10000, allocations: [{ start: 1, end: 1 }] },
      treatments: [
        {
          treatment_id: "t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
        },
        { treatment_id: "c1", title: "C", traffic_percentage: 0, traffic: { weight: 0 } },
      ],
    });
    const [result] = decide(exp, undefined, { experimentId: "exp-1", seedId: "seed-not-in-meg" });
    // Captured from real java-labs-sdk: active=false, control=true, treatmentId=c1, label=C
    expect(result).toEqual({
      active: false,
      control: true,
      treatmentId: "c1",
      label: "C",
    } as ComparableDecision);
  });

  test("MEG includes a seed inside the group's allocation, same as Java", () => {
    const exp = baseExp({
      default_treatment: "c1",
      control_treatment_id: "c1",
      group_id: "group-1",
      traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
      treatments: [
        {
          treatment_id: "t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
        },
        { treatment_id: "c1", title: "C", traffic_percentage: 0, traffic: { weight: 0 } },
      ],
    });
    const [result] = decide(exp, undefined, { experimentId: "exp-1", seedId: "seed-in-meg" });
    // Captured from real java-labs-sdk: active=true, control=false, treatmentId=t1, label=T1
    expect(result).toEqual({
      active: true,
      control: false,
      treatmentId: "t1",
      label: "T1",
    } as ComparableDecision);
  });

  test("MAB policy-group routing resolves to the same treatment as Java", () => {
    const exp = baseExp({
      default_treatment: "c1",
      control_treatment_id: "c1",
      policy_groups: [
        {
          policy_id: "pg1",
          name: "PG1",
          override_seed_id: "SESSION_ID",
          algorithm_type: "BASIC",
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
          treatment_allocations: [
            { treatment_id: "t1", traffic: { weight: 5000 } },
            { treatment_id: "c1", traffic: { weight: 5000 } },
          ],
        },
      ],
      treatments: [
        { treatment_id: "t1", title: "T1", traffic_percentage: 0, traffic: { weight: 0 } },
        { treatment_id: "c1", title: "C", traffic_percentage: 0, traffic: { weight: 0 } },
      ],
    });
    const [result] = decide(exp, undefined, {
      experimentId: "exp-1",
      seedId: "s1",
      context: { sessionId: "session-abc" },
    });
    // Captured from real java-labs-sdk: active=true, control=false, treatmentId=t1, label=T1, policyId=pg1
    expect(result).toEqual({
      active: true,
      control: false,
      treatmentId: "t1",
      label: "T1",
    } as ComparableDecision);
  });

  test("program holdout excludes the child when the parent assigns control, same as Java", () => {
    const child = baseExp({
      experiment_id: "child-exp",
      default_treatment: "child-c",
      control_treatment_id: "child-c",
      parent_experiment_id: "parent-program",
      treatments: [
        {
          treatment_id: "child-t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
        },
        { treatment_id: "child-c", title: "C", traffic_percentage: 0, traffic: { weight: 0 } },
      ],
    });
    const parent = baseExp({
      experiment_id: "parent-program",
      default_treatment: "parent-control",
      control_treatment_id: "parent-control",
      treatments: [
        {
          treatment_id: "parent-control",
          title: "C",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
        },
        { treatment_id: "parent-eligible", title: "T1", traffic_percentage: 0, traffic: { weight: 0 } },
      ],
    });
    const [result] = decide(child, parent, { experimentId: "child-exp", seedId: "holdout-seed" });
    // Captured from real java-labs-sdk: active=false, control=true, treatmentId=child-c, label=C
    expect(result).toEqual({
      active: false,
      control: true,
      treatmentId: "child-c",
      label: "C",
    } as ComparableDecision);
  });

  test("program holdout lets the child proceed when the parent assigns a non-control treatment, same as Java", () => {
    const child = baseExp({
      experiment_id: "child-exp",
      default_treatment: "child-c",
      control_treatment_id: "child-c",
      parent_experiment_id: "parent-program",
      treatments: [
        {
          treatment_id: "child-t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
        },
        { treatment_id: "child-c", title: "C", traffic_percentage: 0, traffic: { weight: 0 } },
      ],
    });
    const parent = baseExp({
      experiment_id: "parent-program",
      default_treatment: "parent-control",
      control_treatment_id: "parent-control",
      treatments: [
        { treatment_id: "parent-control", title: "C", traffic_percentage: 0, traffic: { weight: 0 } },
        {
          treatment_id: "parent-eligible",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
        },
      ],
    });
    const [result] = decide(child, parent, { experimentId: "child-exp", seedId: "holdout-seed" });
    // Captured from real java-labs-sdk: active=true, control=false, treatmentId=child-t1, label=T1
    expect(result).toEqual({
      active: true,
      control: false,
      treatmentId: "child-t1",
      label: "T1",
    } as ComparableDecision);
  });

  test("a missing/unresolvable seed excludes the request, same as Java (EXP_MISSING_SEED)", () => {
    const exp = baseExp({
      default_seed_id: "PROFILE_ID",
      default_treatment: "c1",
      control_treatment_id: "c1",
      treatments: [
        {
          treatment_id: "t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
        },
        { treatment_id: "c1", title: "C", traffic_percentage: 0, traffic: { weight: 0 } },
      ],
    });
    const [result] = decide(exp, undefined, { experimentId: "exp-1", seedId: "" });
    // Captured from real java-labs-sdk: active=false, control=true, treatmentId=c1, label=C
    expect(result).toEqual({
      active: false,
      control: true,
      treatmentId: "c1",
      label: "C",
    } as ComparableDecision);
  });

  test("PROFILE_ID seed resolves from context, same treatment as Java", () => {
    const exp = baseExp({
      default_seed_id: "PROFILE_ID",
      default_treatment: "c1",
      control_treatment_id: "c1",
      treatments: [
        {
          treatment_id: "t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 5000, allocations: [{ start: 1, end: 5000 }] },
        },
        {
          treatment_id: "c1",
          title: "C",
          traffic_percentage: 0,
          traffic: { weight: 5000, allocations: [{ start: 5001, end: 10000 }] },
        },
      ],
    });
    const [result] = decide(exp, undefined, {
      experimentId: "exp-1",
      seedId: "",
      context: { profileId: "p-123" },
    });
    // Captured from real java-labs-sdk: active=true, control=false, treatmentId=t1, label=T1
    expect(result).toEqual({
      active: true,
      control: false,
      treatmentId: "t1",
      label: "T1",
    } as ComparableDecision);
  });

  test("an unpublished experiment is inactive in both SDKs (though only TS surfaces a message)", () => {
    const exp = baseExp({
      published: false,
      default_treatment: "c1",
      control_treatment_id: "c1",
      treatments: [
        {
          treatment_id: "t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
        },
        { treatment_id: "c1", title: "C", traffic_percentage: 0, traffic: { weight: 0 } },
      ],
    });
    const [result] = decide(exp, undefined, { experimentId: "exp-1", seedId: "s1" });
    // Captured from real java-labs-sdk: active=false, control=true, treatmentId=c1, label=C
    expect(result).toEqual({
      active: false,
      control: true,
      treatmentId: "c1",
      label: "C",
    } as ComparableDecision);
  });

  test("an unsupported algorithm_type still lets audience-exclusion win, same ordering as Java (Part A fix)", () => {
    const exp = baseExp({
      algorithm_type: "THOMPSON_SAMPLING",
      default_treatment: "c1",
      control_treatment_id: "c1",
      audience_group: [{ name: "us-only", value: { country: ["us"] } }],
      treatments: [
        {
          treatment_id: "t1",
          title: "T1",
          traffic_percentage: 0,
          traffic: { weight: 10000, allocations: [{ start: 1, end: 10000 }] },
        },
        { treatment_id: "c1", title: "C", traffic_percentage: 0, traffic: { weight: 0 } },
      ],
    });
    const [result] = decide(exp, undefined, {
      experimentId: "exp-1",
      seedId: "s1",
      context: { country: "uk" },
    });
    // Captured from real java-labs-sdk: active=false, control=true, treatmentId=c1, label=C
    // (Java's resolve() would instead THROW past this point for a request that
    // DID match the audience - that's the documented interface difference
    // noted at the top of this file. What matters here is that the audience
    // check runs, and wins, before the algorithm-type check on both sides.)
    expect(result).toEqual({
      active: false,
      control: true,
      treatmentId: "c1",
      label: "C",
    } as ComparableDecision);
  });
});
