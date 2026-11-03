import {
  SDKConfig,
  LabsSDK,
  DecisionRequest,
  DecisionRequests,
  DecisionResponse,
  DecisionResponses,
  DecisionResponseDeferredTracker,
  DecisionResponsesDeferredTracker,
  ExperimentConfiguration,
  ExperimentConfigurations,
  FeatureFlag,
  FlagDecisionRequest,
  FlagDecisionResponse,
  FlagKeyRequest,
  LabsDecisionTracer,
  LabsTraceLevel as TraceLevel,
  LabsTraceFields,
  UserContext,
} from "./types";
import { _internalDecisionService as DecisionService, DecisionMetadata } from "./decision";
import {
  _internalFlagDecisionService as FlagDecisionService,
  FlagDecisionMetadata,
  ResolveExperimentDecision,
} from "./flag-decision";
import { Tracker } from "./internal/tracker";
import { DefaultTracer } from "./internal/default_tracer";
import { Tracer } from "./internal/tracer";
import { ExperimentConfigStore } from "./internal/experiment-store";
import { FlagStore } from "./flag-store";
import { CacheTraceEvent } from "./internal/cache";
import { describeCacheEvent, recordCacheMetric } from "./internal/cache-trace";
import { MetricsInterface, noopMetrics } from "./metrics";
import { ResolvedSDKConfig, resolveConfigUrls } from "./internal/environment-urls";

export type ExperimentMappings = Record<string, ExperimentConfiguration>;

export interface _InternalDecisionTracer {
  trace(level: TraceLevel, id: string, message: string, fields: LabsTraceFields): void;
  traceId: string;
}

type DeferredBulkDecisions = Record<
  string,
  { decision: DecisionResponse; metadata: DecisionMetadata; trace: _InternalDecisionTracer }
>;

class SDK implements LabsSDK {
  private tracker: Tracker;
  private tracer: LabsDecisionTracer = new DefaultTracer();
  private traceLevel = TraceLevel.SUPPRESS_TRACING;
  private decisionService: DecisionService;
  private flagDecisionService: FlagDecisionService;
  private metrics: MetricsInterface;
  // Only set when constructed via NewSDKFromConfig. Used to fire-and-forget
  // "touch" the cache on live decision traffic, since DecisionService reads
  // experimentsMap synchronously and never itself calls into the cache - this
  // is what keeps TTL-triggered background refresh alive in steady state.
  private experimentStore?: ExperimentConfigStore;
  // Only set when constructed via NewSDKFromConfig. Unlike experiments, flag
  // decisions are inherently async and read through this store on every call
  // (there's no separate synchronous map to bypass it), so no equivalent
  // fire-and-forget touch is needed to keep flag caches warm.
  private flagStore?: FlagStore;

  constructor(
    private config: ResolvedSDKConfig,
    experimentSource: ExperimentConfigurations | ExperimentConfiguration | ExperimentConfigStore,
    flagStore?: FlagStore,
  ) {
    this.setTraceListener(new DefaultTracer());

    // trackSettings is the public subset of TrackerOptions (everything except
    // the injectable fetchFn), so forward it wholesale rather than restating
    // each field.
    this.tracker = new Tracker(config.trackUrl, { ...config.trackSettings, fetchFn: config.fetchFn });
    this.metrics = config.metrics ?? noopMetrics;
    this.flagStore = flagStore;

    // A bound closure, not a direct reference, so it always reads whatever
    // decisionService/tracer/traceLevel are current at call time (mirrors
    // Java's LabsEngineImpl construction order: build the experiment engine
    // first, then inject it as a collaborator into the flag engine).
    const resolveExperimentDecision: ResolveExperimentDecision = (request) => {
      const tracer = new Tracer(this.tracer, this.traceLevel);
      return Promise.resolve(this.decisionService.getExperimentDecision(request, tracer));
    };
    this.flagDecisionService = new FlagDecisionService(resolveExperimentDecision);

    if (experimentSource instanceof ExperimentConfigStore) {
      this.experimentStore = experimentSource;
      this.decisionService = new DecisionService(experimentSource.experimentsMap);
      return;
    }

    const experimentsMap: ExperimentMappings = {};
    // Handle both single experiment configuration and array of configurations
    const configurations = Array.isArray(experimentSource) ? experimentSource : [experimentSource];

    for (const experiment of configurations) {
      experimentsMap[experiment.experiment_id] = experiment;
    }

    this.decisionService = new DecisionService(experimentsMap);
  }

  /**
   * Calculates the decision based on the input request and tracks the decision as well
   * @param {DecisionRequest} request
   * @returns DecisionResponse
   */
  getDecision(request: DecisionRequest): DecisionResponse {
    const [decision, metadata, trace] = this.getExperimentDecision(request);

    this.trackProgramParentDecisions(metadata, trace);
    if (metadata.shouldTrack) {
      this.tracker.track(request, decision, metadata.bucket, trace);
    }

    this.tracer.flush();
    return decision;
  }

  /**
   * Calculates the decision based on the input request.
   * If the track decision conditions are met, then the decision response will be tracked as well.
   * @param {DecisionRequest} requests
   * @returns DecisionResponse
   */
  getDecisions(requests: DecisionRequests): DecisionResponses {
    const decisions: DecisionResponse[] = [];

    for (const experimentId of requests.experimentIds) {
      const request: DecisionRequest = {
        experimentId: experimentId,
        seedId: requests.seedId,
        context: requests.context,
      };

      const [decision, metadata, trace] = this.getExperimentDecision(request);

      this.trackProgramParentDecisions(metadata, trace);
      if (metadata.shouldTrack) {
        this.tracker.track(request, decision, metadata.bucket, trace);
      }

      decisions.push(decision);
    }

    this.tracer.flush();
    return { decisions };
  }

  /**
   * Calculates the decision based on input request and returns the decision and track callback function.
   * The decision will not be tracked until the client explicitly calls the track function.
   * @param {DecisionRequest} request
   * @returns DecisionResponseDeferredTracker
   */
  getDeferredDecision(request: DecisionRequest): DecisionResponseDeferredTracker {
    const [decision, metadata, trace] = this.getExperimentDecision(request);
    // Parent program decisions are tracked eagerly (Go parity), not deferred.
    this.trackProgramParentDecisions(metadata, trace);

    return {
      decision: decision,
      track: (contextOverrides?: UserContext) =>
        this.trackOnlyDecision(request, decision, metadata, trace, contextOverrides),
    };
  }

  /**
   * Calculates the decision based on input request and returns the decision and track callback function.
   * The decision will not be tracked until the client explicitly calls the track function.
   * @param {DecisionRequest} request
   * @returns DecisionResponseDeferredTracker
   */
  getDeferredDecisions(requests: DecisionRequests): DecisionResponsesDeferredTracker {
    const decisions: DecisionResponse[] = [];
    const decisionsMap: DeferredBulkDecisions = {};

    for (const experimentId of requests.experimentIds) {
      const request: DecisionRequest = {
        experimentId,
        seedId: requests.seedId,
        context: requests.context,
      };

      const [decision, metadata, trace] = this.getExperimentDecision(request);
      this.trackProgramParentDecisions(metadata, trace);
      decisions.push(decision);
      decisionsMap[experimentId] = { decision, metadata, trace };
    }

    return {
      decisions: decisions,
      track: (experimentId: string, contextOverrides?: UserContext) =>
        this.trackOneDecision(experimentId, requests, decisionsMap, contextOverrides),
    };
  }

  setTraceLevel(level: TraceLevel): void {
    this.traceLevel = level;
  }
  setTraceListener(trace: LabsDecisionTracer): void {
    this.tracer = trace;
  }

  stop(): void {
    this.experimentStore?.stop();
    this.flagStore?.stop();
  }

  getExperimentDecision(
    request: DecisionRequest,
  ): [DecisionResponse, DecisionMetadata, _InternalDecisionTracer] {
    const trace = new Tracer(this.tracer, this.traceLevel);
    const [decision, metadata] = this.decisionService.getExperimentDecision(request, trace);
    this.tracer.flush();
    this.metrics.increment("decision.count", { type: "experiment" });
    this._touchExperimentCache(request.experimentId, metadata);
    return [decision, metadata, trace];
  }

  // Additive to LabsSDK's existing synchronous experiment methods - flags
  // have no equivalent of the pre-warmed synchronous experimentsMap read (a
  // flag lookup fans out across three cache shapes, not one flat map), so
  // this is necessarily async. Resolves to an empty/inactive decision (never
  // throws) when no flagStore exists, e.g. an SDK built via the synchronous
  // NewSDK path.
  async getFlagDecision(request: FlagDecisionRequest): Promise<FlagDecisionResponse> {
    const flag = await this.flagStore?.getById(request.flagId);
    return this._resolveFlagDecision(flag, request);
  }

  async getDecisionByKey(request: FlagKeyRequest): Promise<FlagDecisionResponse> {
    const flag = await this.flagStore?.getByKey(request.projectId, request.key);
    const flagRequest: FlagDecisionRequest = {
      flagId: flag?.uuid ?? "",
      seedId: request.seedId,
      context: request.context,
      profileId: request.profileId,
      userId: request.userId,
    };
    return this._resolveFlagDecision(flag, flagRequest);
  }

  private async _resolveFlagDecision(
    flag: FeatureFlag | undefined,
    request: FlagDecisionRequest,
  ): Promise<FlagDecisionResponse> {
    const trace = new Tracer(this.tracer, this.traceLevel);
    const [decision, metadata]: [FlagDecisionResponse, FlagDecisionMetadata] =
      await this.flagDecisionService.getFlagDecision(flag, request, trace);
    this.tracer.flush();
    this.metrics.increment("decision.count", { type: "flag" });
    if (metadata.shouldTrack) {
      this._trackFlagDecision(flag, request, decision, trace);
    }
    return decision;
  }

  // Reuses the same Tracker used for experiments, unchanged, with a
  // flag-shaped payload (policyId: undefined, bucket: 0 - Go parity: flags
  // never carry a MAB bucket/policy).
  private _trackFlagDecision(
    flag: FeatureFlag | undefined,
    request: FlagDecisionRequest,
    decision: FlagDecisionResponse,
    trace: _InternalDecisionTracer,
  ): void {
    const flagId = flag?.uuid ?? request.flagId;
    const trackingRequest: DecisionRequest = {
      experimentId: flagId,
      seedId: decision.seedId ?? request.seedId ?? "",
      context: request.context,
      profileId: request.profileId,
      userId: request.userId,
    };
    const trackingDecision: DecisionResponse = {
      experimentId: flagId,
      status: "success",
      active: decision.active,
      treatmentId: decision.variantId,
      label: decision.variantKey,
      control: false,
    };
    this.tracker.track(trackingRequest, trackingDecision, 0, trace);
  }

  // Fire-and-forget: keeps the self-loading cache's TTL-triggered refresh
  // alive by "touching" every id that live decision traffic actually
  // requests (including any program-holdout parent), without making
  // getDecision/getDecisions async. No-op when constructed via the
  // synchronous NewSDK path (no experimentStore).
  private _touchExperimentCache(experimentId: string, metadata: DecisionMetadata): void {
    if (!this.experimentStore) {
      return;
    }
    this.experimentStore.ensure(experimentId).catch(() => undefined);
    if (metadata.programParent) {
      this.experimentStore.ensure(metadata.programParent.request.experimentId).catch(() => undefined);
    }
  }

  // Routes a cache lifecycle event (see internal/cache.ts) through whatever
  // tracer/level is currently configured (setTraceListener/setTraceLevel),
  // and records the corresponding metric. Not part of the LabsSDK interface -
  // used internally by NewSDKFromConfig (same module) once the SDK instance
  // exists; warmup-phase events (before construction) are handled separately
  // since there's no SDK instance/traceLevel yet.
  _traceCacheEvent(store: string, event: CacheTraceEvent): void {
    const { level, id, message, fields } = describeCacheEvent(store, event);
    new Tracer(this.tracer, this.traceLevel).trace(level, id, message, fields);
    recordCacheMetric(this.metrics, store, event);
  }

  /**
   * Tracks the decision made for the incoming request
   * @param {DecisionRequest} request
   * @param {DecisionResponse} decision
   * @private
   */
  trackOnlyDecision(
    request: DecisionRequest,
    decision: DecisionResponse,
    metadata: DecisionMetadata,
    trace: _InternalDecisionTracer,
    contextOverrides?: UserContext,
  ): void {
    if (metadata.shouldTrack) {
      this.tracker.track(request, decision, metadata.bucket, trace, contextOverrides);
      this.tracer.flush();
    }
  }

  trackOneDecision(
    experimentId: string,
    requests: DecisionRequests,
    decisionMap: DeferredBulkDecisions,
    contextOverrides?: UserContext,
  ): void {
    const request: DecisionRequest = {
      experimentId: experimentId,
      seedId: requests.seedId,
      context: requests.context,
    };

    const { decision, metadata, trace } = decisionMap[experimentId];
    if (decision != null && metadata?.shouldTrack) {
      this.tracker.track(request, decision, metadata.bucket, trace, contextOverrides);
      this.tracer.flush();
    }
  }

  // Eagerly track parent program decisions produced by the holdout gate (Go
  // parity: CD-62306). Called at decision time, including for deferred APIs.
  private trackProgramParentDecisions(metadata: DecisionMetadata, trace: _InternalDecisionTracer): void {
    const parent = metadata.programParent;
    if (!parent) {
      return;
    }
    this.trackProgramParentDecisions(parent.metadata, trace);
    if (parent.metadata.shouldTrack) {
      this.tracker.track(parent.request, parent.decision, parent.metadata.bucket, trace);
    }
  }
}

export function NewSDK(
  sdkConfig: SDKConfig,
  experimentConfigurations: ExperimentConfigurations | ExperimentConfiguration,
): LabsSDK {
  const sdk = new SDK(resolveConfigUrls(sdkConfig), experimentConfigurations);
  return sdk;
}

export const newSDK = NewSDK;

// Self-loading construction: fetches, caches, and keeps experiment configs
// fresh internally - the consumer only supplies fetchUrl/experimentIds
// (+ optional cacheSettings/metrics) instead of pre-fetching configs
// themselves. Necessarily async (an unavoidable, disclosed difference from
// NewSDK's synchronous signature) since a cold cache requires a real network
// fetch before any decision can be served. NewSDK/newSDK are untouched and
// remain fully supported for callers that already manage their own configs.
//
// `initialTracer`, if supplied, receives warmup-phase cache trace events
// (unfiltered - there's no SDK instance/traceLevel yet to filter by). Once
// construction completes, cache events instead honor whatever
// tracer/level is currently configured via setTraceListener/setTraceLevel.
export async function NewSDKFromConfig(
  sdkConfig: SDKConfig,
  initialTracer?: LabsDecisionTracer,
): Promise<LabsSDK> {
  const resolvedConfig = resolveConfigUrls(sdkConfig);

  let forward: (store: string, event: CacheTraceEvent) => void = initialTracer
    ? (store, event) => {
        const { level, id, message, fields } = describeCacheEvent(store, event);
        const timestamp = new Date();
        initialTracer.OnTrace(level, timestamp, id, message, fields);
        recordCacheMetric(resolvedConfig.metrics ?? noopMetrics, store, event);
      }
    : (store, event) => recordCacheMetric(resolvedConfig.metrics ?? noopMetrics, store, event);

  const experimentStore = new ExperimentConfigStore(resolvedConfig, (event) => forward("experiment", event));
  const flagStore = new FlagStore(resolvedConfig, (store, event) => forward(store, event));
  await Promise.all([experimentStore.warmup(), flagStore.warmup()]);

  const sdk = new SDK(resolvedConfig, experimentStore, flagStore);
  forward = (store, event) => sdk._traceCacheEvent(store, event);
  return sdk;
}

export const newSDKFromConfig = NewSDKFromConfig;

export function getSDKVersion(): string {
  // tag expanded from the rollup version injector package at build time.
  return "[VI]{version}[/VI]";
}
