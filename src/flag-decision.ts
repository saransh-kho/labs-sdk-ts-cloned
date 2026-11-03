import {
  DecisionRequest,
  DecisionResponse,
  FeatureFlag,
  FlagDecisionRequest,
  FlagDecisionResponse,
  FlagDecisionSource,
  FlagVariant,
  LabsTraceLevel as Trace,
  TargetingRule,
} from "./types";
import { _InternalDecisionTracer } from "./sdk";
import { DecisionMetadata, EXP_AUDIENCE_CODE } from "./decision";
import { hash64 } from "./internal/hash";
import { findAllowListMatch, isAudienceGroupSatisfied, TraceFn } from "./audience";
import { FlagSeedType, resolveFlagSeed, SeedResolution } from "./internal/seed";

const TOTAL_TRAFFIC_WEIGHT = 10000;
const TOTAL_LEGACY_WEIGHT = 100;

export type FlagDecisionMetadata = {
  shouldTrack: boolean;
};

export type ResolveExperimentDecision = (
  request: DecisionRequest,
) => Promise<[DecisionResponse, DecisionMetadata]>;

const defaultExperimentResolver: ResolveExperimentDecision = () =>
  Promise.resolve([
    { experimentId: "", status: "error", active: false, control: true, treatmentId: "", label: "C" },
    { bucket: 0, shouldTrack: false },
  ]);

class FlagDecisionService {
  constructor(private resolveExperimentDecision: ResolveExperimentDecision = defaultExperimentResolver) {}

  async getFlagDecision(
    flag: FeatureFlag | undefined,
    request: FlagDecisionRequest,
    tracer: _InternalDecisionTracer,
  ): Promise<[FlagDecisionResponse, FlagDecisionMetadata]> {
    const decider = new FlagDecider(flag, request, tracer, this.resolveExperimentDecision);
    const [decision, metadata] = await decider.getDecision();
    return [{ ...decision, traceId: tracer.traceId }, metadata];
  }
}

function emptyFlagResponse(message?: string): FlagDecisionResponse {
  return {
    flagId: "",
    key: "",
    variantId: "",
    variantKey: "",
    active: false,
    source: "FEATURE",
    ...(message && { message }),
  };
}

// A synthesized rule representing the legacy (schemaVersionNumber === 0)
// flag algorithm - internal-only, never appears in a flag's real
// targetingRules and is not part of the public wire schema (types.ts). This
// is what lets FlagDecider run ONE evaluation loop regardless of flag shape:
// legacy flags are just a rule list of exactly one LEGACY_SPLIT rule.
type LegacySplitRule = { type: "LEGACY_SPLIT" };
type EngineRule = TargetingRule | LegacySplitRule;

type RuleOutcome = { decision: FlagDecisionResponse } | { skip: true; reason: string };

const KNOWN_SEED_TYPES = new Set<string>(Object.values(FlagSeedType));

function allocationNumber(uniqueId: string, totalAllocation: number): number {
  const hash = hash64(uniqueId);
  return Number(hash.mod(totalAllocation)) + 1;
}

function inAllocationRange(n: number, allocations: { start: number; end: number }[] | undefined): boolean {
  return !!allocations?.some((a) => n >= a.start && n <= a.end);
}

// Simulates the 'engine' for a single flag decision - a fresh instance per
// call, mirroring decision.ts's Decider idiom (explicitly preserved/extended
// here rather than dropped for parity with Go/Java's more procedural style).
class FlagDecider {
  private seedResolution?: SeedResolution;
  private metadata: FlagDecisionMetadata = { shouldTrack: false };
  private _trace: _InternalDecisionTracer["trace"];

  constructor(
    private flag: FeatureFlag | undefined,
    private request: FlagDecisionRequest,
    private tracer: _InternalDecisionTracer,
    private resolveExperimentDecision: ResolveExperimentDecision = defaultExperimentResolver,
  ) {
    this._trace = tracer.trace.bind(tracer);
  }

  // Memoized so multiple rule evaluations (each may re-hash) don't re-trace
  // seed resolution more than once per decision - same idiom as Decider.
  private _seed(): SeedResolution {
    if (!this.seedResolution) {
      this.seedResolution = resolveFlagSeed(
        this.flag?.preferredSeedId,
        this.request.seedId,
        this.request.context,
        this.request.profileId,
        this.request.userId,
      );
      this._traceSeed(this.seedResolution);
    }
    return this.seedResolution;
  }

  private _traceSeed({ seedType }: SeedResolution): void {
    const preferred = this.flag?.preferredSeedId;
    // resolveFlagSeed reads an unknown or missing seed type as PROFILE_ID
    const expected = preferred != null && KNOWN_SEED_TYPES.has(preferred) ? preferred : FlagSeedType.Profile;
    if (seedType === "NONE") {
      this._trace(Trace.WARN, "FLAG_SEED_ID", `No seed for type ${expected}; using a random seed`, {
        preferredSeedId: preferred,
      });
    } else if (seedType === FlagSeedType.Custom) {
      this._trace(Trace.INFO, "FLAG_SEED_ID", "Using the request's seedId", {
        preferredSeedId: preferred,
      });
    } else {
      this._trace(Trace.INFO, "FLAG_SEED_ID", `Resolved seed for type ${seedType}`, {
        preferredSeedId: preferred,
      });
    }
  }

  // One bucket per decision, shared by every rule, as Go and Java hash it
  private _trafficBucket(): number {
    return allocationNumber(`${this.flag?.uuid}${this._seed().seedId}`, TOTAL_TRAFFIC_WEIGHT);
  }

  private _audienceTrace(ruleNumber?: number): TraceFn {
    return (level, id, message, fields) =>
      this._trace(
        level,
        `FLAG_AUDIENCE_${id}`,
        message,
        ruleNumber === undefined ? fields : { ...fields, ruleNumber },
      );
  }

  private _allowListTrace(): TraceFn {
    return (level, id, message, fields) => this._trace(level, `FLAG_ALLOWLIST_${id}`, message, fields);
  }

  private _decisionFromVariant(
    variant: FlagVariant,
    active: boolean,
    source: FlagDecisionSource = "FEATURE",
    message?: string,
  ): FlagDecisionResponse {
    const flag = this.flag as FeatureFlag;
    return {
      flagId: flag.uuid,
      key: flag.key,
      variantId: variant.uuid,
      variantKey: variant.name,
      config: variant.config,
      active,
      source,
      ...(message && { message }),
    };
  }

  // A linked decision is the experiment's treatment, as in Go and Java; a
  // treatment mapping only swaps in the flag variant's config or turns it off
  private _decisionFromTreatment(
    expDecision: DecisionResponse,
    source: FlagDecisionSource,
    config: Record<string, unknown> | undefined,
    active = expDecision.active,
  ): FlagDecisionResponse {
    const flag = this.flag as FeatureFlag;
    return {
      flagId: flag.uuid,
      key: flag.key,
      variantId: expDecision.treatmentId,
      variantKey: expDecision.label,
      ...(config && { config }),
      active,
      source,
      ...(expDecision.message && { message: expDecision.message }),
    };
  }

  private _defaultRuleDecision(message: string): FlagDecisionResponse {
    const flag = this.flag as FeatureFlag;
    const defaultRule = flag.defaultRule;
    const variant = flag.metadata.variants?.find((v) => v.name === defaultRule?.variantKey);
    return {
      flagId: flag.uuid,
      key: flag.key,
      variantId: variant?.uuid ?? "",
      variantKey: variant?.name ?? defaultRule?.variantKey ?? "",
      config: variant?.config,
      active: defaultRule?.enabled ?? false,
      source: "FEATURE",
      message,
    };
  }

  public async getDecision(): Promise<[FlagDecisionResponse, FlagDecisionMetadata]> {
    let decision: FlagDecisionResponse | undefined;
    let errorMessage: string | undefined;

    this._trace(Trace.INFO, "START", "getFlagDecision starts", { request: this.request });
    try {
      decision = await this._decide();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      this._trace(Trace.WARN, "ERROR_EXCEPTION", errorMessage, {});
    }
    decision = decision ?? emptyFlagResponse(errorMessage);
    if (this.seedResolution) {
      decision.seedId = this.seedResolution.seedId;
      decision.seedType = this.seedResolution.seedType;
    }
    // Auto-track parity with Go's TRACK_DECISION_TAG: only flags explicitly
    // tagged for it, and only for an active decision.
    this.metadata.shouldTrack = !!(this.flag?.tags?.includes("track_decision_response") && decision.active);
    this._trace(Trace.INFO, "END", "getFlagDecision ends", { decision });
    return [decision, this.metadata];
  }

  private async _decide(): Promise<FlagDecisionResponse> {
    if (!this.flag) {
      this._trace(Trace.ERROR, "FLAG_NO_CONFIG_OBJECT", "Flag configuration is undefined/missing", {});
      return emptyFlagResponse("Flag configuration is undefined/missing");
    }

    this._seed();

    // Legacy flags check their status inside the legacy split
    if (this.flag.metadata.schemaVersionNumber > 0 && !this.flag.metadata.status) {
      this._trace(Trace.WARN, "FLAG_DISABLED", "Flag is not enabled", {});
      return { ...this._defaultRuleDecision("FF-OFF: Flag is not enabled"), active: false };
    }

    const rules = this._buildRuleList(this.flag);
    for (let index = 0; index < rules.length; index++) {
      const rule = rules[index];
      const outcome = await this._evaluateRule(rule, index);
      if ("decision" in outcome) {
        return outcome.decision;
      }
      // Numbered from 1, as Studio and Go's decision messages show rules
      this._trace(
        Trace.INFO,
        "FLAG_RULE_SKIPPED",
        `Rule ${index + 1} (${rule.type}) skipped: ${outcome.reason}`,
        {
          ruleNumber: index + 1,
          rule,
        },
      );
    }

    this._trace(
      Trace.INFO,
      "FLAG_FALLBACK",
      "No targeting rule produced a decision; serving the default rule",
      {
        defaultRule: this.flag.defaultRule,
        rulesEvaluated: rules.length,
      },
    );
    return this._defaultRuleDecision("FF-FALLBACK: Flag fell back to default rule");
  }

  private _buildRuleList(flag: FeatureFlag): EngineRule[] {
    if (flag.metadata.schemaVersionNumber > 0) {
      return flag.targetingRules ?? [];
    }
    return [{ type: "LEGACY_SPLIT" }];
  }

  private async _evaluateRule(rule: EngineRule, index: number): Promise<RuleOutcome> {
    switch (rule.type) {
      case "LEGACY_SPLIT":
        return this._evaluateLegacySplit();
      case "LINKED_EXPERIMENT":
        return this._evaluateLinkedExperiment(rule);
      case "TARGET_TO_PERCENTAGE":
      case "TARGET_TO_AUDIENCE":
        return this._evaluateTargetRule(rule, index);
      case "RANDOM_SPLIT":
        return this._evaluateRandomSplit(rule, index);
      default:
        this._trace(Trace.WARN, "FLAG_UNSUPPORTED_RULE", "Targeting rule type is not supported", { rule });
        return { skip: true, reason: "unsupported rule type" };
    }
  }

  // --- LEGACY_SPLIT (schemaVersionNumber === 0) ---------------------------

  private _evaluateLegacySplit(): RuleOutcome {
    const flag = this.flag as FeatureFlag;

    if (!flag.metadata.status) {
      this._trace(Trace.WARN, "FLAG_DISABLED", "Flag is not enabled", {});
      return { decision: this._defaultRuleDecision("FF-OFF: Flag is not enabled") };
    }

    if (flag.audienceGroup?.length) {
      const satisfied = isAudienceGroupSatisfied(
        flag.audienceGroup,
        this.request.context,
        this._audienceTrace(),
      );
      if (!satisfied) {
        this._trace(Trace.WARN, "FLAG_AUDIENCE_EXCLUSION", "Flag audience requirements not met", {});
        return { decision: this._defaultRuleDecision("FF-AUDIENCE: audience requirements not met") };
      }
    }

    const variants = flag.metadata.variants ?? [];
    if (variants.length === 0) {
      this._trace(Trace.INFO, "FLAG_NO_VARIANT", "Flag has no variants", {});
      return {
        decision: {
          flagId: flag.uuid,
          key: flag.key,
          variantId: "",
          variantKey: "V1",
          active: flag.metadata.status,
          source: "FEATURE",
          message: "FF-NOVARIANT",
        },
      };
    }
    if (variants.length === 1) {
      this._trace(Trace.INFO, "FLAG_ONE_VARIANT", "Flag has exactly one variant", { variant: variants[0] });
      return {
        decision: this._decisionFromVariant(variants[0], flag.metadata.status, "FEATURE", "FF-ONEVARIANT"),
      };
    }

    const allowListMatch = findAllowListMatch(variants, this.request.context, this._allowListTrace());
    if (allowListMatch) {
      this._trace(Trace.INFO, "FLAG_WHITELIST_HIT", "Flag whitelist matched a variant", {
        variant: allowListMatch,
      });
      return { decision: this._decisionFromVariant(allowListMatch, true, "FEATURE", "FF-ALLOW") };
    }

    const uniqueId = `${flag.uuid}${this._seed().seedId}`;
    const n = allocationNumber(uniqueId, TOTAL_LEGACY_WEIGHT);
    let runningTotal = 0;
    const variant = variants.find((v) => {
      runningTotal += v.trafficPercentage ?? 0;
      return n <= runningTotal;
    });

    if (!variant) {
      this._trace(Trace.WARN, "FLAG_NO_ALLOCATION", "No variant found for legacy traffic split", {
        n,
        variants,
      });
      return { decision: this._defaultRuleDecision("FF-NOALLOCATION: no variant found for traffic split") };
    }

    this._trace(Trace.INFO, "FLAG_SPLIT", "Legacy traffic split resolved a variant", { variant, n });
    return { decision: this._decisionFromVariant(variant, true) };
  }

  // --- TARGET_TO_PERCENTAGE / TARGET_TO_AUDIENCE --------------------------

  private _evaluateTargetRule(rule: TargetingRule, index: number): RuleOutcome {
    const flag = this.flag as FeatureFlag;

    if (rule.audienceGroup?.length) {
      const satisfied = isAudienceGroupSatisfied(
        rule.audienceGroup,
        this.request.context,
        this._audienceTrace(index + 1),
      );
      if (!satisfied) {
        return { skip: true, reason: "audience not met" };
      }
    }

    const weight = rule.target?.traffic?.weight;
    let inRange = true;
    if (weight !== undefined && weight < TOTAL_TRAFFIC_WEIGHT) {
      const n = this._trafficBucket();
      inRange = rule.target?.traffic?.allocations
        ? inAllocationRange(n, rule.target.traffic.allocations)
        : n <= weight;
    }

    if (!inRange) {
      this._trace(Trace.INFO, "FLAG_ROLLOUT_EXCLUDE", "Rollout targeting rule excluded the request", {
        rule,
      });
      return {
        decision: this._defaultRuleDecision(
          `FF-TARGETING-RULES-AUDIENCE-ROLLOUT_EXCLUDE: RULE ${index + 1} part of audience but excluded due to rollout`,
        ),
      };
    }

    const variant = flag.metadata.variants?.find((v) => v.name === rule.target?.variantKey);
    if (!variant) {
      this._trace(Trace.ERROR, "FLAG_AUDIENCE_RULE_MATCH", "Targeting rule variant not found on flag", {
        rule,
      });
      return { skip: true, reason: "target variant not found on flag" };
    }

    this._trace(Trace.INFO, "FLAG_AUDIENCE_RULE_MATCH", "Targeting rule matched a variant", {
      rule,
      variant,
    });
    return {
      decision: this._decisionFromVariant(
        variant,
        true,
        "FEATURE",
        `FF-TARGETING-RULES-AUDIENCE: RULE ${index + 1} part of audience and part of rollout`,
      ),
    };
  }

  // --- RANDOM_SPLIT --------------------------------------------------------

  private _evaluateRandomSplit(rule: TargetingRule, index: number): RuleOutcome {
    const flag = this.flag as FeatureFlag;

    if (rule.audienceGroup?.length) {
      const satisfied = isAudienceGroupSatisfied(
        rule.audienceGroup,
        this.request.context,
        this._audienceTrace(index + 1),
      );
      if (!satisfied) {
        return { skip: true, reason: "audience not met" };
      }
    }

    const n = this._trafficBucket();
    const targets = rule.targets ?? [];
    let target: (typeof targets)[number] | undefined;
    if (targets.some((t) => t.traffic?.allocations)) {
      target = targets.find((t) => inAllocationRange(n, t.traffic?.allocations));
    } else {
      // Go and Java only match allocations; weights cover configs that carry none
      let runningTotal = 0;
      target = targets.find((t) => {
        runningTotal += t.traffic?.weight ?? 0;
        return n <= runningTotal;
      });
    }

    const variant = target && flag.metadata.variants?.find((v) => v.name === target.variantKey);
    if (!variant) {
      // Swallow to fall-through (Java parity, and TS's own trace-then-continue
      // idiom - see Decider._findRandomTreatment) rather than Go's stricter
      // propagate-and-catch.
      this._trace(Trace.ERROR, "FLAG_RANDOM_SPLIT_ERROR", "No variant found for random split allocation", {
        n,
        rule,
      });
      return { skip: true, reason: "no variant for its random split allocation" };
    }

    this._trace(Trace.INFO, "FLAG_RANDOM_SPLIT", "Random split rule matched a variant", { rule, variant });
    return {
      decision: this._decisionFromVariant(
        variant,
        true,
        "FEATURE",
        `FF-TARGETING-RULES-RANDOM-SPLIT: RULE ${index + 1} part of audience and split into variant`,
      ),
    };
  }

  // --- LINKED_EXPERIMENT ---------------------------------------------------

  private async _evaluateLinkedExperiment(rule: TargetingRule): Promise<RuleOutcome> {
    const flag = this.flag as FeatureFlag;

    if (!rule.experimentId) {
      this._trace(
        Trace.ERROR,
        "FLAG_LINKED_EXPERIMENT_ERROR",
        "Linked experiment rule missing experimentId",
        {
          rule,
        },
      );
      return { skip: true, reason: "missing experimentId" };
    }

    // The caller's own seed, not the flag's resolved or random one, so the
    // experiment resolves its seed types itself and can exclude when they are missing
    const experimentRequest: DecisionRequest = {
      experimentId: rule.experimentId,
      seedId: this.request.seedId ?? "",
      profileId: this.request.profileId,
      userId: this.request.userId,
      context: this.request.context,
    };
    const [expDecision, expMetadata] = await this.resolveExperimentDecision(experimentRequest);

    if (expDecision.status === "error") {
      // Experiment not found/loaded - distinguish from "found but excluded",
      // which is a normal, valid fall-through-eligible outcome below.
      this._trace(Trace.ERROR, "FLAG_LINKED_EXPERIMENT_ERROR", "Linked experiment could not be resolved", {
        rule,
        expDecision,
      });
      return { skip: true, reason: "linked experiment could not be resolved" };
    }

    if (expMetadata.unpublished) {
      return { skip: true, reason: "linked experiment is not published" };
    }

    if (
      rule.linkedExperimentConfig?.onlyEnableRuleForExperimentAudience &&
      expMetadata.exclusionCode === EXP_AUDIENCE_CODE
    ) {
      return { skip: true, reason: "outside the linked experiment's audience" };
    }

    const source: FlagDecisionSource = expDecision.active ? "EXPERIMENT" : "EXPERIMENT:INACTIVE";
    const mapping = rule.linkedExperimentConfig?.treatmentMapping?.[expDecision.treatmentId];
    if (!mapping) {
      this._trace(
        Trace.ERROR,
        "FLAG_LINKED_EXPERIMENT_TREATMENT_MAPPING_NOT_FOUND",
        "No variant mapping for the linked experiment's treatment; serving the treatment",
        { rule, treatmentId: expDecision.treatmentId },
      );
      return { decision: this._decisionFromTreatment(expDecision, source, expDecision.config) };
    }

    // An empty variant key experiments on the flag being off
    if (!mapping.variantKey) {
      this._trace(Trace.INFO, "FLAG_LINKED_EXPERIMENT", "Linked experiment treatment turns the flag off", {
        rule,
        expDecision,
      });
      return { decision: this._decisionFromTreatment(expDecision, source, undefined, false) };
    }

    const variant = flag.metadata.variants?.find((v) => v.name === mapping.variantKey);
    if (!variant) {
      this._trace(
        Trace.ERROR,
        "FLAG_LINKED_EXPERIMENT_VARIANT_NOT_FOUND",
        "Mapped variant not found on flag; serving the treatment",
        { rule, mapping },
      );
      return { decision: this._decisionFromTreatment(expDecision, source, expDecision.config) };
    }

    this._trace(Trace.INFO, "FLAG_LINKED_EXPERIMENT", "Linked experiment resolved a variant", {
      rule,
      expDecision,
      variant,
    });
    return { decision: this._decisionFromTreatment(expDecision, source, variant.config) };
  }
}

export { FlagDecisionService as _internalFlagDecisionService, FlagDecider as _internalFlagDecider };
