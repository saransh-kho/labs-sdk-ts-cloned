import { MetricsInterface } from "./metrics";
import { CacheSettings } from "./internal/cache";
import { FetchFn } from "./internal/http";

export type UUID = string;
export type { CacheSettings };

// user context like context["country"] = "us", ...
export type ContextValue = string | string[];
export type UserContext = Record<string, ContextValue>;

export type DecisionRequest = {
  experimentId: UUID;
  seedId: string;
  context?: UserContext;
  // Optional request-level identifiers. When provided they take precedence
  // over the matching context keys (merged into context during a decision).
  profileId?: string;
  userId?: string;
};

export type DecisionRequests = {
  experimentIds: UUID[];
  seedId: string;
  context?: UserContext;
};

export type DecisionStatus = "success" | "error";

// If message is defined, a default decision was
// returned and message will have a reason why
export type DecisionResponse = {
  experimentId: UUID; // reflects the original id requested
  status: DecisionStatus;
  active: boolean; // on/off
  treatmentId: UUID; // which variation/treatment was selected
  label: string;
  config?: Record<string, unknown>; // the selected treatment's config, if it has one
  control: boolean; // is this the default control treatment
  message?: string; // if status is error, this will have a message
  policyId?: UUID; // which policy group was selected for Multi-armed bandit experiments
  policyName?: string; // name of the selected policy group (MAB)
  seedId?: string; // the resolved seed value used for bucketing
  seedType?: string; // which seed type was used (PROFILE_ID, USER_ID, SESSION_ID, DEVICE_ID, SEED_ID, or NONE)
  traceId?: UUID; // unique per decision
};

export type DecisionResponses = {
  decisions: DecisionResponse[];
};

export type TrackDecision = (contextOverrides?: UserContext) => void;
export type TrackSingleDecision = (experimentId: string, contextOverrides?: UserContext) => void;

export type DecisionResponseDeferredTracker = {
  decision: DecisionResponse;
  track: TrackDecision;
};

export type DecisionResponsesDeferredTracker = {
  decisions: DecisionResponse[];
  track: TrackSingleDecision;
};

export interface LabsSDK {
  // Single request
  getDecision(request: DecisionRequest): DecisionResponse;
  getDeferredDecision(request: DecisionRequest): DecisionResponseDeferredTracker;

  // Bulk requests
  getDecisions(requests: DecisionRequests): DecisionResponses;
  getDeferredDecisions(requests: DecisionRequests): DecisionResponsesDeferredTracker;

  // Feature flags. Necessarily async, unlike the experiment methods above -
  // a flag lookup fans out across cache-backed stores rather than reading a
  // pre-warmed synchronous map. Only meaningful on an SDK constructed via
  // NewSDKFromConfig; resolves to an inactive/empty decision (never throws)
  // otherwise.
  getFlagDecision(request: FlagDecisionRequest): Promise<FlagDecisionResponse>;
  getDecisionByKey(request: FlagKeyRequest): Promise<FlagDecisionResponse>;

  // Set a custom tracer, or level
  // By default console logging at the DEBUG_TRACE level is enabled
  setTraceListener(tracer: LabsDecisionTracer): void;
  setTraceLevel(level: LabsTraceLevel): void;

  // Lifecycle cleanup - safe to call on any SDK instance (no-op when there's
  // nothing to clean up, e.g. one built via the synchronous NewSDK path).
  // Matches labs-sdk-go's SDKInterface.Stop(): a place to hang cleanup on for
  // long-running processes, even though today's cache has no background
  // timers of its own to clear.
  stop(): void;
}

export enum LabsTraceLevel {
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,

  UNKNOWN = 99,
  SUPPRESS_TRACING = UNKNOWN + 1, // don't trace anything
}
export function levelToString(level: LabsTraceLevel): string {
  return LabsTraceLevel[level];
}

export type LabsTraceFields = Record<string, unknown>;
// Anyone can add a trace implementation using the setTraceListener method of LabsSDK
// That same method can also be used to adjust the level for what is traced.
export interface LabsDecisionTracer {
  // `fields` will always have a few 'well known' keys:
  //     'timestamp' - When the trace was generated (value is a Date() object)
  //     'traceId' - unique per 'decision'.  Can be used to group traces for a single decision
  //                  after the fact (if they aren't grouped and logged atomically)
  OnTrace(level: LabsTraceLevel, timestamp: Date, id: string, message: string, fields: LabsTraceFields): void;

  // Called after decision render, and again after track() call
  flush(): void; // called at end of decision processing. Can be empty if not buffering.
}

// A pure lookup-table key (see internal/environment-urls.ts), not tied to
// process.env - resolves identically in Node and browser builds.
export type Environment = "prod" | "stage" | "int" | "dev";

export type SDKConfig = {
  // Either fetchUrl/trackUrl or environment must be set - explicit URLs
  // always win over environment's looked-up defaults when both are given.
  fetchUrl?: string;
  trackUrl?: string;
  environment?: Environment;
  experimentIds: UUID[];
  // Self-loading/caching (NewSDKFromConfig only - ignored by the synchronous
  // NewSDK path). All fields optional; sensible defaults are applied
  // internally when omitted.
  cacheSettings?: CacheSettings;
  // Pluggable metrics sink (counters/gauges), separate from the trace/log
  // hook. Defaults to a no-op implementation - the core package never bundles
  // a real metrics backend.
  metrics?: MetricsInterface;
  // Feature flags (NewSDKFromConfig only). flagFetchUrl defaults to fetchUrl
  // when omitted. flagIds is an optional static warmup seed list - flags are
  // otherwise naturally lazy/on-demand, unlike experiments.
  flagFetchUrl?: string;
  flagCacheSettings?: CacheSettings;
  flagProjectCacheSettings?: CacheSettings;
  flagIds?: UUID[];
  // Bounds every fetch (experiment config, flag config, tracking) with a
  // timeout via AbortController. Default: 10s. Applies to NewSDKFromConfig's
  // fetches; also honored by the standalone getExperimentConfigs() helper.
  requestTimeoutMs?: number;
  // Pluggable fetch implementation, defaulting to the global `fetch`. Lets
  // consumers inject custom auth/proxy/retry behavior, and makes tests
  // trivial - pass a fake instead of monkey-patching global.fetch.
  fetchFn?: FetchFn;
  // Tracking (Tracker.track) behavior: request timeout and a dedupe/throttle
  // cache that suppresses re-sending an identical decision (same
  // experimentId+treatmentId+seedId+bucket) within dedupeTtlMs, mirroring
  // Go/Java's "prevent flooding repeated track messages" behavior. All
  // fields optional; dedupe is on by default.
  trackSettings?: {
    timeoutMs?: number;
    dedupeEnabled?: boolean;
    dedupeCacheSize?: number;
    dedupeTtlMs?: number;
  };
};

export type Audience = {
  name: string;
  value: Record<string, string[]>; // ie: platform: ["web", "mobile"]
  query?: string;
};

export type AudienceGroup = Audience[];

export interface CustomOperators {
  "=~": (subject: string, pattern: string) => boolean;
  semver_cmp: (operator: string, ...operands: string[]) => boolean;
  icase_compare: (operator: string, operand1: string, ...operands: any[]) => boolean;
}

// Follows global-communication-schema. Primarily an internal
// opaque type (returned from getExperimentConfigs and passed into
// getExperimentDecision).  exported for transparency and debugability
export type ExperimentConfiguration = {
  experiment_id: UUID;
  treatments: Treatment[];
  treatment_ids: UUID[];
  experiment_type: string;
  algorithm_type: string;
  evaluation_order?: string[] | null;
  total_enabled: boolean;
  is_feature: boolean;
  published: boolean;
  audience_group?: AudienceGroup;
  num_of_unique_ctx_in_audience?: number;
  default_treatment?: UUID;
  control_treatment_id?: UUID;
  default_seed_id?: string;
  traffic?: Traffic;
  group_id?: string;
  policy_groups?: Policy[];
  // Program holdout: a child experiment names its parent program here; the
  // child is held out (inactive) when the seed falls in the parent's control
  // bucket. is_program marks the parent program container.
  parent_experiment_id?: string;
  is_program?: boolean;
};

export type Traffic = {
  weight: number;
  allocations?: Allocation[];
};

export type Policy = {
  policy_id: UUID;
  name: string;
  override_seed_id: string;
  algorithm_type: string;
  traffic: Traffic;
  treatment_allocations: TreatmentAllocation[];
};

export type TreatmentAllocation = {
  treatment_id: UUID;
  traffic: Traffic;
};

export type Allocation = {
  start: number;
  end: number;
};

export type ExperimentConfigurations = ExperimentConfiguration[];

export type AllowListValue = {
  op?: string;
  values: string[];
};

export type AllowListItems = Record<string, AllowListValue> | null;

export type Treatment = {
  treatment_id: UUID;
  traffic_percentage: number;
  title: string;
  whitelist?: {
    items?: AllowListItems;
  };
  traffic?: {
    weight: number;
    allocations?: Allocation[];
  };
  config?: Record<string, unknown>;
};

// --- Feature flags -----------------------------------------------------
// Mirrors labs-sdk-go's internal/model_flags.go / java-labs-sdk's Flag record
// (flattened into one type, matching Java's shape rather than Go's
// FeatureFlag/FlagWithTag embed-split, which TS gains nothing from).

export type RuleType = "RANDOM_SPLIT" | "TARGET_TO_PERCENTAGE" | "TARGET_TO_AUDIENCE" | "LINKED_EXPERIMENT";

export type FlagVariant = {
  uuid: UUID;
  name: string;
  config?: Record<string, unknown>;
  trafficPercentage?: number; // legacy (schemaVersionNumber === 0) path only
  whitelist?: {
    items?: AllowListItems;
  };
};

export type FlagMetadata = {
  variants?: FlagVariant[];
  status: boolean; // on/off
  schemaVersionNumber: number; // > 0 => targetingRules path, 0 => legacy split
};

export type VariantTarget = {
  variantKey?: string;
  traffic?: Traffic;
};

export type LinkedTreatmentConfig = { variantKey: string };

export type LinkedExperimentConfig = {
  treatmentMapping: Record<string, LinkedTreatmentConfig>; // keyed by treatmentId
  onlyEnableRuleForExperimentAudience: boolean;
};

export type TargetingRule = {
  ruleId?: UUID;
  type: RuleType;
  audienceGroup?: AudienceGroup;
  target?: VariantTarget; // TARGET_TO_PERCENTAGE / TARGET_TO_AUDIENCE
  targets?: VariantTarget[]; // RANDOM_SPLIT
  experimentId?: UUID; // LINKED_EXPERIMENT
  linkedExperimentConfig?: LinkedExperimentConfig; // LINKED_EXPERIMENT
};

export type DefaultRule = {
  variantKey?: string;
  enabled: boolean;
};

export type FeatureFlag = {
  uuid: UUID;
  key: string;
  projectId: UUID;
  tags?: string[];
  linkedExperiments?: UUID[];
  metadata: FlagMetadata;
  audienceGroup?: AudienceGroup;
  preferredSeedId?: string;
  targetingRules?: TargetingRule[];
  defaultRule?: DefaultRule;
};

export type FlagDecisionRequest = {
  flagId: UUID;
  seedId?: string; // optional - an unresolvable seed falls back to a random UUID (Go/Java parity), unlike experiments
  context?: UserContext;
  profileId?: string;
  userId?: string;
};

export type FlagKeyRequest = {
  projectId: string;
  key: string;
  seedId?: string;
  context?: UserContext;
  profileId?: string;
  userId?: string;
};

export type FlagDecisionSource = "FEATURE" | "EXPERIMENT" | "EXPERIMENT:INACTIVE";

export type FlagDecisionResponse = {
  flagId: UUID;
  key: string;
  variantId: UUID;
  variantKey: string;
  config?: Record<string, unknown>;
  active: boolean;
  source: FlagDecisionSource;
  message?: string;
  seedId?: string;
  seedType?: string;
  traceId?: UUID;
};
