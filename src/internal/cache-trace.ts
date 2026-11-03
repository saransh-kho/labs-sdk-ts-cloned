// Shared mapping from cache lifecycle events (src/internal/cache.ts) onto the
// existing LabsDecisionTracer/LabsTraceFields conventions and the metrics
// interface - used identically by the experiment store (Part B) and the flag
// stores (Part C) so cache observability is consistent across both.
import { CacheOp, CacheTraceEvent } from "./cache";
import { LabsTraceFields, LabsTraceLevel as TraceLevel } from "../types";
import { MetricsInterface } from "../metrics";

type CacheTraceMapping = { id: string; level: TraceLevel; metric?: string };

const CACHE_OP_MAPPING: Record<CacheOp, CacheTraceMapping> = {
  load: { id: "CACHE_LOAD", level: TraceLevel.DEBUG },
  hit: { id: "CACHE_HIT", level: TraceLevel.DEBUG, metric: "cache.hit" },
  miss: { id: "CACHE_MISS", level: TraceLevel.DEBUG, metric: "cache.miss" },
  "refresh-start": { id: "CACHE_REFRESH_START", level: TraceLevel.INFO, metric: "cache.refresh.start" },
  "refresh-success": { id: "CACHE_REFRESH_SUCCESS", level: TraceLevel.INFO, metric: "cache.refresh.success" },
  "refresh-failure": { id: "CACHE_REFRESH_FAILURE", level: TraceLevel.WARN, metric: "cache.refresh.failure" },
  "negative-hit": { id: "CACHE_NEGATIVE_HIT", level: TraceLevel.DEBUG, metric: "cache.negative_hit" },
  "not-found": { id: "CACHE_NOT_FOUND", level: TraceLevel.WARN, metric: "cache.not_found" },
  "load-error": { id: "CACHE_LOAD", level: TraceLevel.ERROR, metric: "cache.load.error" },
  eviction: { id: "CACHE_EVICT", level: TraceLevel.INFO, metric: "cache.evict" },
};

export type CacheTraceDescription = {
  level: TraceLevel;
  id: string;
  message: string;
  fields: LabsTraceFields;
};

// `store` distinguishes which cache this event came from (e.g. "experiment",
// "flag", "flag-alias", "flag-project") without fragmenting the shared
// `component: "cache"` filter convention.
export function describeCacheEvent(store: string, event: CacheTraceEvent): CacheTraceDescription {
  const mapping = CACHE_OP_MAPPING[event.op];
  return {
    level: mapping.level,
    id: mapping.id,
    message: `Cache ${event.op} (${store}): ${event.key}`,
    fields: {
      component: "cache",
      store,
      key: event.key,
      ...(event.ageMs !== undefined && { ageMs: event.ageMs }),
      ...(event.error !== undefined && { error: event.error }),
    },
  };
}

export function recordCacheMetric(metrics: MetricsInterface, store: string, event: CacheTraceEvent): void {
  const metric = CACHE_OP_MAPPING[event.op].metric;
  if (metric) {
    metrics.increment(metric, { store });
  }
}
