import Long from "long";
import {
  DecisionRequest,
  DecisionResponse,
  ExperimentConfiguration,
  LabsTraceLevel as Trace,
  Policy,
  Treatment,
} from "./types";
import { hash64 } from "./internal/hash";
import { _internalAudienceService as AudienceService } from "./audience";
import { _InternalDecisionTracer } from "./sdk";

// Go's code for an audience exclusion
export const EXP_AUDIENCE_CODE = "EXP-AUDIENCE";

class DecisionService {
  constructor(private experimentsMap: Record<string, ExperimentConfiguration>) {}

  getExperimentDecision(
    request: DecisionRequest,
    tracer: _InternalDecisionTracer,
  ): [DecisionResponse, DecisionMetadata] {
    const config = this.experimentsMap[request?.experimentId];

    // tracer and level passed to each Decider so it's config can't change in the middle
    // of processing a decision.  Any re-config will get picked up on the next decision.
    const resolveDecision = (req: DecisionRequest) => this.getExperimentDecision(req, tracer);
    const decider = new Decider(config, request, tracer, this.experimentsMap, resolveDecision);
    const [decision, metadata] = decider.getDecision();
    return [{ ...decision, traceId: tracer.traceId }, metadata];
  }
}

function EmptyResponse(message: string | undefined = undefined): DecisionResponse {
  return {
    experimentId: "",
    status: "error",
    control: true,
    treatmentId: "",
    label: "C",
    active: false,
    ...(message && { message: message }),
  };
}

// Reports whether treatmentId is the control treatment for the given config.
// Prefers the explicit control_treatment_id, falling back to the historical
// label === "C" convention (Go parity: isControlTreatment). Takes the config
// explicitly so it can also be applied to a parent program config.
function isControlTreatmentFor(config: ExperimentConfiguration, treatmentId: string | undefined): boolean {
  if (!treatmentId) {
    return false;
  }
  const controlId = config.control_treatment_id;
  if (controlId) {
    return treatmentId === controlId;
  }
  const labeledControlId = config.treatments?.find((e) => e.title === "C")?.treatment_id;
  return !!labeledControlId && treatmentId === labeledControlId;
}

export type ProgramParentDecision = {
  request: DecisionRequest;
  decision: DecisionResponse;
  metadata: DecisionMetadata;
};

export type DecisionMetadata = {
  bucket: number;
  shouldTrack: boolean;
  // Set when a child experiment runs a full parent decision for the program
  // holdout gate. The SDK tracks the parent eagerly (Go parity: CD-62306).
  programParent?: ProgramParentDecision;
  // Why the request was excluded, where a caller needs to tell exclusions
  // apart (Java's response code); e.g. EXP_AUDIENCE_CODE
  exclusionCode?: string;
  // Go and Java skip a flag's linked experiment rule when it isn't published
  unpublished?: boolean;
};

type DecisionResolver = (request: DecisionRequest) => [DecisionResponse, DecisionMetadata];

// Result of resolving a seed: the resolved value, the type that produced it,
// and a typed EXP-* code when no seed could be resolved at all.
type SeedResolution = {
  seedId?: string;
  seedType: string;
  code?: string;
};

// Simulates the 'service' Go SDK.  Also holds the decision state while processing
class Decider {
  private static readonly DefaultSeedIdProfile = "PROFILE_ID";
  private static readonly DefaultSeedIdUser = "USER_ID";
  private static readonly DefaultSeedIdCustom = "SEED_ID";
  private static readonly DefaultSeedIdSession = "SESSION_ID";
  private static readonly DefaultSeedIdDevice = "DEVICE_ID";

  private static readonly AlgorithmBasic = "BASIC";
  private static readonly AlgorithmEpsilonFirst = "EPSILON_FIRST";
  private static readonly TotalTrafficWeight = 10000;

  private audienceService: AudienceService;
  private _trace: _InternalDecisionTracer["trace"];
  private metadata: DecisionMetadata;
  private seedResolution?: SeedResolution;

  constructor(
    private config: ExperimentConfiguration,
    private request: DecisionRequest,
    private tracer: _InternalDecisionTracer,
    private experimentsMap: Record<string, ExperimentConfiguration> = {},
    private resolveDecision: DecisionResolver = () => [
      EmptyResponse("decision resolver not configured"),
      { bucket: 0, shouldTrack: false },
    ],
  ) {
    this._trace = tracer.trace.bind(tracer);
    this.audienceService = new AudienceService(config, tracer);
    this.metadata = {
      bucket: 0,
      shouldTrack: false,
    };
  }

  _isControlTreatment(treatmentId: string | undefined): boolean {
    return isControlTreatmentFor(this.config, treatmentId);
  }

  _getDefaultDecision(message?: string): DecisionResponse {
    const treatments = this.config.treatments;
    // Go parity: prefer the configured default treatment; fall back to the
    // explicit control treatment when the default is unset or not found.
    let treatmentId = this.config.default_treatment;
    if (!treatmentId || !treatments?.some((e) => e.treatment_id === treatmentId)) {
      treatmentId = this.config.control_treatment_id ?? treatmentId;
    }

    // If neither the default nor the control treatment actually exists in the
    // config's treatments (e.g. a malformed experiment whose default_treatment
    // points at a non-existent id, or whose treatments are empty), don't
    // surface a phantom treatment id. Go and Java hard-error in this case; TS
    // stays soft-failing but returns an empty id rather than a dangling one.
    const resolved = treatments?.find((e) => e.treatment_id === treatmentId);
    if (!resolved) {
      treatmentId = undefined;
    }

    const label = resolved?.title;

    const published: boolean | undefined = this.config.published;
    const decision: DecisionResponse = {
      experimentId: this.request.experimentId,
      status: "success",
      control: this._isControlTreatment(treatmentId),
      treatmentId: treatmentId ?? "",
      label: label ?? "",
      ...(resolved?.config && { config: resolved.config }),
      active: published === true,
    };

    if (message) {
      decision.message = message;
      // inactive/unpublished experiments always have 'successful' decisions.
      // Make sure 'error' is set for malformed config missing the published field
      if (published !== false) {
        decision.status = "error";
      }
    }

    return decision;
  }

  _decisionFromTreatment(treatment: Treatment): DecisionResponse {
    const isControl = this._isControlTreatment(treatment.treatment_id);

    const decision: DecisionResponse = {
      experimentId: this.request.experimentId,
      status: "success",
      control: isControl,
      treatmentId: treatment.treatment_id,
      label: treatment.title,
      ...(treatment.config && { config: treatment.config }),
      active: this.config.published,
    };
    return decision;
  }

  _getExperimentTotalAllocation(): number {
    let total = 0;
    // If exp has new traffic allocations object, then we always have 10000 as traffic weight
    if (this._useTrafficObjectForAllocation()) {
      total = Decider.TotalTrafficWeight;
    } else {
      // For backwards compatability. If the exps are created before adding the traffic allocations feature,
      // then follow this approach.
      if (this.config.treatments) {
        total = this.config.treatments.reduce((total, e) => total + (e.traffic_percentage ?? 0), total);

        total = Math.min(total, 100.0);
      }

      // Go parity: default to 100 when the legacy percentages sum to 0 (e.g.
      // all treatments have traffic_percentage unset), so this resolves to a
      // normal inactive decision rather than an unresolvable allocation space.
      if (total === 0) {
        total = 100;
      }
    }

    return total;
  }

  _getAllocationForRequest(totalAllocation: number, isMEGAllocationRequest: boolean): number {
    // If the experiment is not published, then return 0
    if (totalAllocation <= 0) {
      throw new Error("Total allocation space for experiment is <= 0");
    }
    const seedId = this._getSeedId();
    if (seedId === undefined) {
      return 0;
    }

    /**
     * isMEGAllocationRequest = true -> Generate uniqueId using `group_id`.
     * This is to check if the request (random number generated) is assigned to the exp which is part of MEG.
     * isMEGAllocationRequest = false -> Generate uniqueId using `experimentId`.
     * This is to check if the request (random number generated) is assigned to the treatments in the exp.
     */
    let uniqueId: string;
    if (isMEGAllocationRequest && this.config.group_id) {
      uniqueId = `${this.config.group_id}${seedId}`;
      this._trace(Trace.DEBUG, "SEED_ID", "MEG GroupId based SEED", { groupId: this.config.group_id });
    } else {
      uniqueId = `${this.config.experiment_id}${seedId}`;
      this._trace(Trace.INFO, "SEED_ID", "Experiment based SEED", {
        experimentId: this.config.experiment_id,
      });
    }

    const hash: Long = hash64(uniqueId);
    const n = Number(hash.mod(totalAllocation));

    // index 1-based (1 to totalAllocation) go match golang implementations
    this._trace(Trace.DEBUG, "SEED_ID", `Bucket ${n + 1} of ${totalAllocation + 1} from SEED`, {});
    return n + 1;
  }

  // Merge request-level profileId/userId into the context (request wins),
  // mirroring Go's normalizeContext so audience rules and tracking see a single
  // consistent view regardless of whether the caller supplied these as request
  // fields or as context keys. No-op when neither is present.
  _normalizeContext(): void {
    const profileId = this._nonEmpty(this.request.profileId) ?? this._contextString("profileId");
    const userId = this._nonEmpty(this.request.userId) ?? this._contextString("userId");
    if (profileId == null && userId == null) {
      return;
    }
    const context = (this.request.context ??= {});
    if (profileId != null) {
      context["profileId"] = profileId;
      this.request.profileId = profileId;
    }
    if (userId != null) {
      context["userId"] = userId;
      this.request.userId = userId;
    }
  }

  _nonEmpty(value: string | undefined): string | undefined {
    return value != null && value.length > 0 ? value : undefined;
  }

  _contextString(fieldName: string): string | undefined {
    const value = this.request.context?.[fieldName];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  // Memoized resolution of the experiment's default seed, so it resolves (and
  // traces) exactly once per decision.
  _mainSeed(): SeedResolution {
    return (this.seedResolution ??= this._resolveSeed(this.config.default_seed_id));
  }

  // Convenience accessor for the resolved default seed value.
  _getSeedId(): string | undefined {
    return this._mainSeed().seedId;
  }

  // Resolves a seed for the given seed type, mirroring Go's util.GetSeedId:
  // resolve the typed field, and when it is missing fall back to the request's
  // explicit seedId (WARN, not an error). Only when there is no seed at all is
  // a typed EXP-* code returned so the caller can exclude.
  _resolveSeed(seedType: string | undefined): SeedResolution {
    const requestSeedId = this._nonEmpty(this.request.seedId);
    let seedId: string | undefined = requestSeedId;
    let resolvedType = Decider.DefaultSeedIdCustom;
    let code: string | undefined;

    switch (seedType) {
      case Decider.DefaultSeedIdCustom:
        if (!requestSeedId) {
          code = "EXP-SEEDMISSING";
        }
        break;
      case Decider.DefaultSeedIdUser: {
        const userId = this._nonEmpty(this.request.userId) ?? this._contextString("userId");
        if (!userId) {
          code = "EXP-NOUSERID";
        } else {
          seedId = userId;
          resolvedType = Decider.DefaultSeedIdUser;
        }
        break;
      }
      case Decider.DefaultSeedIdSession: {
        const sessionId = this._contextString("sessionId");
        if (!sessionId) {
          code = "EXP-NOSESSIONID";
        } else {
          seedId = sessionId;
          resolvedType = Decider.DefaultSeedIdSession;
        }
        break;
      }
      case Decider.DefaultSeedIdDevice: {
        const deviceId = this._contextString("deviceId");
        if (!deviceId) {
          code = "EXP-NODEVICEID";
        } else {
          seedId = deviceId;
          resolvedType = Decider.DefaultSeedIdDevice;
        }
        break;
      }
      default: {
        // PROFILE_ID or unknown type: default to profile id.
        const profileId = this._nonEmpty(this.request.profileId) ?? this._contextString("profileId");
        if (!profileId) {
          code = "EXP-NOPROFILEID";
        } else {
          seedId = profileId;
          resolvedType = Decider.DefaultSeedIdProfile;
        }
        break;
      }
    }

    if (code) {
      if (!seedId) {
        // No seed at all - surface the typed code so the caller can exclude.
        this._trace(Trace.WARN, "SEED_ID", `Missing required seed for type ${seedType}`, { seedType, code });
        return { seedId: undefined, seedType: "NONE", code };
      }
      // Typed field missing but an explicit request seedId is present; fall back
      // to it (Go parity: WARN, not an error).
      this._trace(Trace.WARN, "SEED_ID", `Seed type ${seedType} not present; using provided seedId`, {
        seedType,
      });
      return { seedId, seedType: Decider.DefaultSeedIdCustom };
    }

    this._trace(Trace.INFO, "SEED_ID", `Resolved seed for type ${resolvedType}`, { seedType, resolvedType });
    return { seedId, seedType: resolvedType };
  }

  _findRandomTreatment(randomNumber: number): Treatment | undefined {
    let treatment;
    if (this._useTrafficObjectForAllocation()) {
      treatment = this._findTreatmentFromTrafficAllocation(randomNumber);
    } else {
      let runningTotal = 0;

      treatment = this.config.treatments?.find((e) => {
        runningTotal += e.traffic_percentage ?? 0;
        // random is 1 - 100, not 0 to 99 - to match the Go implementations
        return randomNumber <= runningTotal;
      });

      if (treatment) {
        this._trace(Trace.INFO, "TREATMENT", "Legacy Treatment found", { treatment });
      } else {
        // just in case there's some weird float rounding problem.
        this._trace(Trace.ERROR, "NO_TREATMENT", "Legacy Treatment NOT fount. Total distribution not 100?", {
          treatments: this.config.treatments,
          randomNumber,
          runningTotal,
        });
      }
    }
    return treatment;
  }

  _findTreatmentFromTrafficAllocation(randomNumber: number): Treatment | undefined {
    let treatment;
    treatmentLoop: for (const tr of this.config.treatments) {
      for (const allocation of tr.traffic?.allocations ?? []) {
        if (randomNumber >= allocation.start && randomNumber <= allocation.end) {
          treatment = tr;
          break treatmentLoop;
        }
      }
    }
    if (treatment) {
      this._trace(Trace.INFO, "TREATMENT", "Treatment found from Traffic Allocation", { treatment });
    } else {
      this._trace(Trace.INFO, "NO_TREATMENT", "Treatment NOT found from Traffic Allocation", {
        treatments: this.config.treatments,
      });
    }
    return treatment;
  }

  _getRandomNumberInPolicyGroup(policy: Policy): number | undefined {
    // Go parity: resolve the override seed by the policy's override_seed_id
    // type (falling back to the experiment's default seed type), honoring all
    // seed types. When the override seed cannot be resolved at all, the
    // decision is excluded - there is no random fallback (Go parity).
    const overrideType = policy.override_seed_id || this.config.default_seed_id;
    const override = this._resolveSeed(overrideType);

    if (!override.seedId) {
      this._trace(Trace.WARN, "SEED_ID", "No resolvable policy override seed; excluding", {
        policy_id: policy.policy_id,
        code: override.code,
      });
      return undefined;
    }

    const randomStr = `${policy.policy_id}${override.seedId}`;
    const hash: Long = hash64(randomStr);
    const result = Number(hash.mod(Decider.TotalTrafficWeight)) + 1;

    this._trace(Trace.INFO, "SEED_ID", `Final Policy Seed Result: ${result}`, {
      seedId: override.seedId,
      policy_id: policy.policy_id,
      finalSeedId: randomStr,
      n: result,
    });

    return result;
  }

  _findTreatmentInPolicyGroups(randomNumber: number): [Treatment?, Policy?] {
    let treatment: Treatment | undefined;
    let policy_match: Policy | undefined;
    this._trace(Trace.DEBUG, "POLICY", "Finding treatment in policy groups", { randomNumber });
    policyLoop: for (const policy of this.config.policy_groups ?? []) {
      this._trace(Trace.DEBUG, "POLICY", "Checking allocations in policy", { randomNumber, policy });

      for (const allocation of policy.traffic?.allocations ?? []) {
        // User falls into a specific policy group
        if (randomNumber >= allocation.start && randomNumber <= allocation.end) {
          policy_match = policy;
          const randomNumberInGroup = this._getRandomNumberInPolicyGroup(policy);
          if (randomNumberInGroup === undefined) {
            // Unresolvable override seed -> no treatment (Go parity: exclude).
            break policyLoop;
          }
          let runningTotal = 0;
          const treatment_target = policy.treatment_allocations?.find((t) => {
            runningTotal += t.traffic.weight ?? 0;
            return randomNumberInGroup <= runningTotal;
          });

          treatment = this.config.treatments?.find((t) => {
            return t.treatment_id == treatment_target?.treatment_id;
          });
          this._trace(Trace.DEBUG, "POLICY", "Policy Matched", {
            randomNumber,
            policy_id: policy.policy_id,
            treatment,
            allocation,
          });

          break policyLoop;
        }
      }
    }
    this._trace(Trace.INFO, "MAB", "Policy match result", { treatment, policy_match });
    return [treatment, policy_match];
  }

  _splitTraffic(): DecisionResponse | undefined {
    let randomTreatment, policy;
    const totalAllocation = this._getExperimentTotalAllocation();
    const bucketNumber = this._getAllocationForRequest(totalAllocation, false);
    if (bucketNumber <= 0) {
      const message = `Experiment ${this.config.experiment_id} is inactive due to no seed_id.`;
      this._trace(Trace.WARN, "NO_ALLOCATION", message, {
        seedType: this.config.default_seed_id,
        experimentId: this.config.experiment_id,
      });
      return this._excludeDecision(message);
    }

    this.metadata.bucket = bucketNumber;

    // if the test type is MAB, then check if the request is  allocated to one of the policy groups and then to a treatment in the allocated group
    if (this._isMABExp()) {
      [randomTreatment, policy] = this._findTreatmentInPolicyGroups(bucketNumber);
    } else {
      randomTreatment = this._findRandomTreatment(bucketNumber);
    }

    if (randomTreatment == null) {
      const message = `Experiment ${this.config.experiment_id} is inactive due to traffic allocation.`;
      this._trace(Trace.WARN, "NO_ALLOCATION", message, {});
      return this._excludeDecision(message);
    }

    const decision = this._decisionFromTreatment(randomTreatment);
    if (policy) {
      decision.policyId = policy.policy_id;
      decision.policyName = policy.name;
    }
    // Here is where we would track the decision if we were tracking.
    // Note (Go parity, intentionally NOT ported): the Go SDK only auto-tracks
    // when experiment_type === "NON_CONTEXTUAL". That gate is a legacy
    // filtering mechanism whose field is effectively unused here, so the TS SDK
    // does not replicate it.
    this.metadata.shouldTrack = true;
    return decision;
  }

  _decide(): DecisionResponse {
    const emptyResponse = EmptyResponse();

    if (!this.config) {
      emptyResponse.message = "Experiment configuration is undefined/missing";
      this._trace(Trace.ERROR, "NO_CONFIG_OBJECT", emptyResponse.message, {});
      return emptyResponse;
    }

    if (!this.request) {
      emptyResponse.message = "request parameter undefined";
      this._trace(Trace.ERROR, "NO_REQUEST", emptyResponse.message, {});
      return emptyResponse;
    }

    if (this.config.experiment_id !== this.request.experimentId) {
      emptyResponse.message = `Experiment ID request/cfg mismatch: ${this.config.experiment_id}, req: ${this.request.experimentId}`;
      this._trace(Trace.ERROR, "NO_CONFIG_FOUND", emptyResponse.message, {});
      return emptyResponse;
    }

    // Merge request-level profileId/userId into context up front (Go parity).
    this._normalizeContext();

    if (!this.config.published) {
      // Go parity: an unpublished experiment yields a default inactive decision
      // rather than throwing. The TS SDK runs against caller-supplied configs
      // and is expected to only ever simulate published experiments, so this is
      // surfaced as a strong WARN.
      this._trace(
        Trace.WARN,
        "UNPUBLISHED",
        "Experiment is not published; returning default inactive decision. TS experiments are expected to always be published.",
        { experimentId: this.config.experiment_id },
      );
      this.metadata.unpublished = true;
      return this._getDefaultDecision("experiment has not been activated/published");
    }

    // Resolve the seed up front (Go parity). A request with no resolvable seed
    // at all is excluded here with a typed EXP-* code, before audience/holdout,
    // rather than surfacing late as a generic "no allocation". An explicit
    // request seedId is used as a fallback when a typed field is missing.
    const seed = this._mainSeed();
    if (seed.code) {
      const message = `${seed.code}: required seed not present`;
      this._trace(Trace.WARN, "SEED_ID", message, {
        code: seed.code,
        seedType: this.config.default_seed_id,
      });
      return this._excludeDecision(message);
    }

    // Program holdout gate (Go parity, CD-62306): run a full decision for the
    // parent program first so holdout and parent tracking share the same
    // bucketing path. Safe from infinite recursion — program experiments carry
    // no parent_experiment_id. Runs before audience so holdout wins over
    // audience and allowlist.
    const parentId = this.config.parent_experiment_id;
    if (parentId) {
      const parentRequest: DecisionRequest = {
        experimentId: parentId,
        seedId: this._getSeedId() ?? this.request.seedId,
        profileId: this.request.profileId,
        userId: this.request.userId,
        context: this.request.context,
      };
      const [parentDecision, parentMetadata] = this.resolveDecision(parentRequest);
      this.metadata.programParent = {
        request: parentRequest,
        decision: parentDecision,
        metadata: parentMetadata,
      };

      const parentConfig = this.experimentsMap[parentId];
      if (!parentConfig || parentDecision.status === "error") {
        this._trace(Trace.WARN, "PROGRAM_HOLDOUT", "Could not get parent decision; failing closed", {
          parentId,
        });
        return this._excludeDecision("Inactive due to program holdout.");
      }

      if (parentDecision.control) {
        this._trace(Trace.WARN, "PROGRAM_HOLDOUT", "Inactive due to program holdout", { parentId });
        return this._excludeDecision("Inactive due to program holdout.");
      }
    }

    // Audience filtering, AudienceService does it's own tracing
    if (!this.audienceService.isRequestSatisfied(this.request.context)) {
      // set the message, return success with an 'inactive' experiment
      this.metadata.exclusionCode = EXP_AUDIENCE_CODE;
      return this._excludeDecision(`${EXP_AUDIENCE_CODE}: Inactive due to audience control.`);
    }

    // Allow list filtering, AudienceService does it's own tracing
    const treatment = this.audienceService.treatmentFromAllowList(this.request.context);
    if (treatment) {
      return this._decisionFromTreatment(treatment);
    }

    // Check if the exp is part of Mutually Exclusive Group
    this._trace(Trace.DEBUG, "MEG", "Starting Mutually Exclusive Group Check", {});
    if (this._isExpPartOfMEG()) {
      // Check if the request is allocated to this exp in MEG.
      if (!this._isRequestAllocatedToExperiment()) {
        const message = `Experiment ${this.config.experiment_id} is inactive because request is not part of Mutually Exclusive Group.`;
        this._trace(Trace.WARN, "MEG_EXCLUDE", message, {});
        return this._excludeDecision(message);
      }
    }

    // Algorithm guard (Go parity: runs last, immediately before bucketing, so
    // holdout/audience/allow-list/MEG exclusions still apply normally for an
    // experiment with an unsupported algorithm_type). Only BASIC and
    // EPSILON_FIRST are supported; anything else (THOMPSON_SAMPLING,
    // unknown/empty types) is rejected.
    if (
      this.config.algorithm_type !== Decider.AlgorithmBasic &&
      this.config.algorithm_type !== Decider.AlgorithmEpsilonFirst
    ) {
      throw new Error(`${this.config.algorithm_type} is not supported yet`);
    }

    let decision = this._splitTraffic();
    decision ??= this._getDefaultDecision("failed to select a treatment bucket");
    return decision;
  }

  _handleError(error: unknown): string | undefined {
    let message: string | undefined;
    if (error instanceof Error) {
      message = error.message;
      console.log(`Warn: ${error.name} - ${error.message}`);
    } else {
      console.log("Received error with undefined message");
    }

    return message;
  }

  _useTrafficObjectForAllocation(): boolean {
    const useTraffic = this.config.traffic && this.config.traffic.weight ? true : false;

    this._trace(Trace.DEBUG, "TRAFFIC", `${useTraffic ? "" : "NOT "}Using traffic object for allocation`, {
      traffic: this.config.traffic,
    });
    return useTraffic;
  }

  _isExpPartOfMEG(): boolean {
    const inMEG = this.config.group_id ? true : false;
    if (inMEG) {
      this._trace(Trace.DEBUG, "MEG", "Experiment is part of MEG", { groupId: this.config.group_id });
    }
    return inMEG;
  }

  _isMABExp(): boolean {
    const inMAB = this.config.policy_groups ? true : false;
    if (inMAB) {
      this._trace(Trace.DEBUG, "MAB", "Experiment part of MAB", { policy: this.config.policy_groups });
    }
    return inMAB;
  }

  // Return default decision with active set to false , which will not track the user decision
  _excludeDecision(message: string): DecisionResponse {
    const decision = this._getDefaultDecision(message);
    decision.active = false;
    decision.status = "success";
    return decision;
  }

  _isRequestAllocatedToExperiment(): boolean {
    let inGroup = false;
    const randomNumber = this._getAllocationForRequest(Decider.TotalTrafficWeight, true);
    allocationsLoop: for (const allocation of this.config.traffic?.allocations ?? []) {
      if (randomNumber >= allocation.start && randomNumber <= allocation.end) {
        inGroup = true;
        break allocationsLoop;
      }
    }
    return inGroup;
  }

  public getDecision(): [DecisionResponse, DecisionMetadata] {
    let decision: DecisionResponse | undefined;
    let decisionErrorMessage: string | undefined;
    const fields = { request: this.request };

    try {
      this._trace(Trace.INFO, "START", "getDecision starts", fields);
      decision = this._decide();
    } catch (error) {
      decisionErrorMessage = this._handleError(error);
      this._trace(Trace.WARN, "ERROR_EXCEPTION", decisionErrorMessage ?? "Unknown Error", { fields });
    }
    decision = decision ?? this._getDefaultDecision(decisionErrorMessage);
    // Stamp the resolved seed onto the response (Go parity) when resolution ran.
    if (this.seedResolution) {
      decision.seedId = this.seedResolution.seedId;
      decision.seedType = this.seedResolution.seedType;
    }
    this._trace(Trace.INFO, "END", "getDecision() ends", { decision });

    return [decision, this.metadata];
  }
}

export { DecisionService as _internalDecisionService, Decider as _internalDecider };
