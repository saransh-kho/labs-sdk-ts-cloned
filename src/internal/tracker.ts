import {
  LabsTraceLevel as TraceLevel,
  DecisionRequest,
  DecisionResponse,
  UserContext,
  ContextValue,
} from "../types";
import { _InternalDecisionTracer } from "../sdk";
import { DefaultRequestTimeoutMs, FetchFn, fetchWithTimeout } from "./http";
import { DedupeCache } from "./dedupe-cache";

export type TrackerOptions = {
  timeoutMs?: number;
  fetchFn?: FetchFn;
  dedupeEnabled?: boolean;
  dedupeCacheSize?: number;
  dedupeTtlMs?: number;
};

const DefaultDedupeCacheSize = 1000;
const DefaultDedupeTtlMs = 60_000;

export class Tracker {
  private timeoutMs: number;
  private fetchFn: FetchFn;
  private dedupe?: DedupeCache;

  constructor(
    private trackUrl: string,
    options?: TrackerOptions,
  ) {
    this.timeoutMs = options?.timeoutMs ?? DefaultRequestTimeoutMs;
    this.fetchFn = options?.fetchFn ?? fetch;
    if (options?.dedupeEnabled ?? true) {
      this.dedupe = new DedupeCache(
        options?.dedupeCacheSize ?? DefaultDedupeCacheSize,
        options?.dedupeTtlMs ?? DefaultDedupeTtlMs,
      );
    }
  }

  public async track(
    request: DecisionRequest,
    decision: DecisionResponse,
    bucket: number,
    tracer: _InternalDecisionTracer,
    contextOverrides?: UserContext,
  ): Promise<void> {
    // Compute string showing which keys in original context are about to get overwritten
    const overwrittenKeys: string[] = [];
    const newKeys: string[] = [];

    // We want to track changes to the context, so we track and send original values
    // in the _overridden field, and new keys in the _newkeys field.
    if (contextOverrides) {
      Object.keys(contextOverrides).forEach((key) => {
        if (request.context && key in request.context) {
          // Only track if the value is actually different
          if (!areContextValuesEqual(request.context[key], contextOverrides[key])) {
            overwrittenKeys.push(`[${key}: ${request.context[key]}]`);
          }
        } else {
          newKeys.push(`${key}`);
        }
      });
    }

    // Create new context by merging request.context with contextOverrides
    const context = contextOverrides ? { ...request.context, ...contextOverrides } : request.context;

    if (context) {
      if (overwrittenKeys.length > 0) {
        const overwrittenKeysString = overwrittenKeys.join(", ");
        context["_overridden"] = overwrittenKeysString;
      }

      if (newKeys.length > 0) {
        const newKeysString = newKeys.join(", ");
        context["_newkeys"] = newKeysString;
      }
    }

    const trace = tracer.trace.bind(tracer);

    // Dedupe/throttle: suppress re-sending an identical decision (same
    // experiment/treatment/seed/bucket/effective-context) within the dedupe
    // window, mirroring Go/Java's "prevent flooding repeated track messages"
    // behavior. Context is included in the signature so a meaningfully
    // different contextOverrides call is never suppressed.
    if (this.dedupe) {
      const signature = `${request.experimentId}:${decision.treatmentId}:${request.seedId}:${bucket}:${JSON.stringify(context ?? {})}`;
      if (this.dedupe.shouldThrottle(signature)) {
        trace(TraceLevel.DEBUG, "TRACK_THROTTLED", "track() call suppressed (duplicate decision).", {
          signature,
        });
        return;
      }
    }

    const payload = JSON.stringify({
      experiment_id: request.experimentId,
      treatment_id: decision.treatmentId,
      seed_id: request.seedId,
      bucket: Number(bucket),
      profile_id: request.context?.profileId, // don't take any context override
      user_id: request.context?.userId, // don't take any context override
      policy_id: decision.policyId,
      context: context,
      // TODO: Go parity gap — populate segment_id from experiment.segments[0] when
      // the loaded experiment config is available. See README.md "Known gaps vs labs-sdk-go".
    });

    // support a null:// protocol/device for simulation and end-to-end
    // testing that won't push data to analytics.
    if (this.trackUrl.toLowerCase().startsWith("null:")) {
      return;
    }

    if (this.trackUrl === "") {
      trace(TraceLevel.WARN, "NO_TRACKURL", "track() called with no trackUrl configured.", {
        decision,
      });
      return;
    }

    const options: RequestInit = {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: payload,
    };

    try {
      const response = await fetchWithTimeout(this.fetchFn, this.trackUrl, options, this.timeoutMs);
      if (!response.ok) {
        const json = await response.json();
        trace(TraceLevel.WARN, "TRACK", "track() fetch call failed.", { json, status: response.status });
      } else {
        trace(TraceLevel.DEBUG, "TRACK", "track() call succeeded.", { decision });
      }
    } catch (error) {
      trace(TraceLevel.ERROR, "TRACK", "track() fetch exception.", { error });
    }
  }
}

function areContextValuesEqual(a: ContextValue, b: ContextValue): boolean {
  // Handle string vs string
  if (typeof a === "string" && typeof b === "string") {
    return a === b;
  }

  // Handle array vs array - treat as sets (order-independent)
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }

    // Count occurrences of each element in array 'a'
    const counter = new Map<string, number>();
    for (const item of a) {
      counter.set(item, (counter.get(item) ?? 0) + 1);
    }

    // Now 'undo' the counter tracking based on array 'b'
    for (const s of b) {
      const n = counter.get(s);
      if (n === undefined) return false; // string not seen in 'a'
      if (n === 1) counter.delete(s);
      else counter.set(s, n - 1);
    }

    return counter.size === 0;
  }

  // Mixed types (string vs array) are not equal
  return false;
}
