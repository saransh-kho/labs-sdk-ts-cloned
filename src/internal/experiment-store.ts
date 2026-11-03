import { ExperimentConfiguration } from "../types";
import { AsyncCache, CacheTraceEvent, CacheTraceSink } from "./cache";
import { fetchOneExperimentConfig } from "../experiment";
import { FetchOptions } from "./http";
import { ResolvedSDKConfig } from "./environment-urls";

export type ExperimentMappings = Record<string, ExperimentConfiguration>;

// Program-holdout parent prefetch recursion depth guard, in case of a
// misconfigured cycle in parent_experiment_id.
const MAX_PARENT_PREFETCH_DEPTH = 10;

// Wraps AsyncCache<UUID, ExperimentConfiguration> and exposes a live-mutated
// experimentsMap - the same object reference for the store's lifetime,
// write-through on every load/refresh. DecisionService already reads
// experimentsMap[id] by reference on every call and never copies it, so
// pointing it at this live object requires zero changes to decision.ts.
export class ExperimentConfigStore {
  readonly experimentsMap: ExperimentMappings = {};
  private cache: AsyncCache<string, ExperimentConfiguration>;

  constructor(
    private config: ResolvedSDKConfig,
    onEvent?: CacheTraceSink,
  ) {
    const fetchOptions: FetchOptions = { timeoutMs: config.requestTimeoutMs, fetchFn: config.fetchFn };
    this.cache = new AsyncCache<string, ExperimentConfiguration>(
      config.cacheSettings ?? {},
      (id) => fetchOneExperimentConfig(config.fetchUrl, id, fetchOptions),
      onEvent,
    );
  }

  // Fire-and-forget: ensures `id` is loaded/fresh, writing through into
  // experimentsMap on success and never rejecting. This is the mechanism that
  // keeps steady-state TTL-triggered refresh alive: DecisionService reads
  // experimentsMap synchronously and never itself calls into the cache, so a
  // live decision path (SDK.getExperimentDecision, wired in Part B M3) calls
  // this - without awaiting it - on every real request to "touch" the cache.
  ensure(id: string): Promise<void> {
    return this.cache.getOrLoad(id).then(
      (value) => {
        this.experimentsMap[id] = value;
      },
      () => {
        delete this.experimentsMap[id];
      },
    );
  }

  async warmup(): Promise<void> {
    const requestedIds = this.config.experimentIds ?? [];
    // Originally-requested ids hard-fail warmup on error/not-found, matching
    // today's getExperimentConfigs throw-on-missing behavior.
    await Promise.all(requestedIds.map((id) => this._loadAndStore(id)));

    // Recursive program-holdout parent prefetch: a parent not explicitly
    // requested is WARN-traced but does not fail warmup - Decider already
    // fails closed per-decision when a parent config is missing.
    let idsToScan = requestedIds;
    for (let depth = 0; depth < MAX_PARENT_PREFETCH_DEPTH && idsToScan.length > 0; depth++) {
      const newParentIds = this._discoverUnloadedParents(idsToScan);
      if (newParentIds.length === 0) {
        break;
      }
      await Promise.all(newParentIds.map((id) => this.ensure(id)));
      idsToScan = newParentIds;
    }
  }

  stop(): void {
    this.cache.stop();
  }

  private async _loadAndStore(id: string): Promise<void> {
    const value = await this.cache.getOrLoad(id);
    this.experimentsMap[id] = value;
  }

  private _discoverUnloadedParents(ids: string[]): string[] {
    const parents = new Set<string>();
    for (const id of ids) {
      const parentId = this.experimentsMap[id]?.parent_experiment_id;
      if (parentId && this.experimentsMap[parentId] === undefined) {
        parents.add(parentId);
      }
    }
    return Array.from(parents);
  }
}

export type { CacheTraceEvent };
