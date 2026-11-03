# labs-sdk-ts

TypeScript library for running experiments on JS and TS clients.

`labs-sdk-ts` includes the following components:

- `labs-sdk-ts`
  A labs object can be created with `NewSDK(sdkConfig, experimentConfigs)`. The returned object implements the `LabsSDK` interface, which has the main entrypoint of `getDecision(request: DecisionRequest): DecisionResponse;`
  `experimentConfigs` is an array of the experiments that may be referenced for decisions.

  This current implementation has `getExperimentConfigs` - a direct API to retrieve an experimentation configurations. The experiment configurations retrieved come from the `experimentIds` array in the passed in sdk-config object and are retrieved from the `fetchURL` in that same config. That same configuration is passed to `NewSDK`. [Usage](#usage).

  Alternatively, `NewSDKFromConfig(sdkConfig)` self-loads: it fetches, caches, and keeps experiment configs fresh internally, so the caller never manages configs directly. See [Self-loading / caching](#self-loading--caching).

## Installation

```bash
npm install @wbd/labs-sdk-ts
```

See [Module formats & compatibility](#module-formats--compatibility) for how CommonJS, ESM, and browser consumers each resolve, and [Porting / updating](#porting--updating) if you are updating an existing integration.

## Self-loading / caching

`NewSDKFromConfig(sdkConfig, initialTracer?)` is an async alternative to `NewSDK` for callers who don't want to manage experiment configs themselves:

```typescript
import { NewSDKFromConfig, SDKConfig } from "@wbd/labs-sdk-ts";

const config: SDKConfig = {
  fetchUrl: "https://.../labs/api/v1/debug/experiments",
  trackUrl: "https://.../labs/api/v1/decision/track",
  experimentIds: ["UUID-UUID-UUID"],
  cacheSettings: { ttlMs: 180_000, maxSize: 500, negativeTtlMs: 15_000, errorTtlMs: 5_000 }, // all optional
};

const sdk = await NewSDKFromConfig(config);
const decision = sdk.getDecision({ experimentId: "UUID-UUID-UUID", seedId: "user123" });
```

This is necessarily async - a cold cache requires a real network fetch before any decision can be served - but `getDecision`/`getDecisions`/etc. remain fully synchronous once constructed, identical in shape to the `NewSDK` path. `NewSDK`/`newSDK` are unchanged and remain fully supported for callers that already manage their own configs (e.g. offline/simulated decision evaluation).

Program-holdout parent configs (`parent_experiment_id`) are prefetched automatically and recursively - unlike the `NewSDK` path, you don't need to include parent configs yourself.

Caching is a simple TTL + stale-while-revalidate + negative-cache design: a read past `ttlMs` returns the last-known-good value immediately while refreshing in the background (no polling, no background threads - refresh is entirely triggered by live decision traffic). Cache lifecycle events (load, hit, miss, refresh, eviction, not-found) are reported through the same `LabsDecisionTracer`/`setTraceListener`/`setTraceLevel` hook used for decision tracing, tagged with `fields.component === "cache"` so they can be filtered independently, and are also recorded via the optional `SDKConfig.metrics` (`MetricsInterface`) sink if one is supplied - the core package ships only that interface plus a no-op default, so no metrics backend is bundled into either build.

There is no separate retry-with-backoff mechanism for failed fetches - a failed load is cached as an error for `errorTtlMs` and simply retried on the next call past that window, which acts as a de facto fixed-interval backoff. This is considered sufficient for this SDK's needs.

### Request timeouts and fetch injection

Every fetch (experiment config, flag config, and tracking) is bounded by a timeout and goes through an injectable fetch implementation:

```typescript
const config: SDKConfig = {
  fetchUrl: "...",
  trackUrl: "...",
  experimentIds: [...],
  requestTimeoutMs: 10_000, // default; applies to experiment/flag config fetches
  fetchFn: myCustomFetch,   // optional, defaults to global fetch - inject custom auth/proxy/retry behavior, or a fake for tests
};
```

### Tracking: timeout and dedupe/throttle

`Tracker.track()` (used internally by `getDecision`/`getDecisions`/deferred tracking) is bounded by its own timeout and suppresses re-sending an identical decision (same experimentId+treatmentId+seedId+bucket+effective-context) within a dedupe window, mirroring Go/Java's "prevent flooding repeated track messages" behavior:

```typescript
const config: SDKConfig = {
  // ...
  trackSettings: {
    timeoutMs: 5_000, // default
    dedupeEnabled: true, // default - set false to send every decision unconditionally
    dedupeCacheSize: 1_000, // default
    dedupeTtlMs: 60_000, // default
  },
};
```

### Lifecycle

`sdk.stop()` is safe to call on any SDK instance. On a `NewSDKFromConfig` SDK it stops the underlying cache stores; on a `NewSDK` (synchronous) SDK it's a no-op, since there's nothing to clean up.

## Feature flags

Available on an SDK built via `NewSDKFromConfig` (flags require the self-loading cache layer above; they are not available on the synchronous `NewSDK` path):

```typescript
const decision = await sdk.getFlagDecision({ flagId: "UUID-UUID-UUID", seedId: "user123" });
// or resolve by project + key instead of id:
const decision = await sdk.getDecisionByKey({ projectId: "project-1", key: "my-flag", seedId: "user123" });
```

Both methods are `async` - unlike the synchronous experiment decision methods, a flag lookup fans out across cache-backed stores (by id, by project+key, by project) rather than reading one pre-warmed synchronous map. `SDKConfig.flagFetchUrl` (defaults to `fetchUrl`), `flagCacheSettings`, `flagProjectCacheSettings`, and `flagIds` (an optional static warmup seed list) configure the flag side of things.

A flag's `targetingRules` are evaluated in order (`RANDOM_SPLIT`, `TARGET_TO_PERCENTAGE`, `TARGET_TO_AUDIENCE`, `LINKED_EXPERIMENT` - the last of which can delegate to and gate on an underlying experiment's decision). Legacy flags (no targeting rules) are evaluated through the same engine, just with a single synthesized rule representing the old disabled/audience/whitelist/percentage-split algorithm.

## CLI (`labs-cli`)

A Node-only command-line tool for probing live experiment/flag decisions - a separate build target (`rollup.cli.config.mjs`), not part of the browser dev/prod bundles. Output is always a single clean JSON value on stdout (no decorative header, unlike Go/Java's CLIs) so it's directly consumable by scripts or an AI agent driving it programmatically.

```bash
npm run build-cli
node dist/cli.mjs --env int --exp-id <uuid> --context '{"profileId":"p1"}'
node dist/cli.mjs --env dev --flag-key my-flag --project-id <proj> --context '{}' --seed s1
node dist/cli.mjs --env prod --show-config
node dist/cli.mjs --help   # full flag reference
```

By default, tracking is suppressed (`trackUrl` forced to a `null:` sink) so probing never pushes real analytics events - pass `--track` to opt in. `--trace <level>` streams SDK trace events to stderr as JSON lines, one per event.

### Cross-SDK comparison

`--compare go,java` runs the same inputs through pre-built Go/Java `labs-cli` binaries (paths via `--go-cli-path`/`--java-cli-jar`) and reports each one's parsed output alongside an `active`-field comparison - the one field guaranteed comparable across all three SDKs' differently-shaped decision responses (Go/Java converged experiments and flags into a single unified `Decision` shape; TS still exposes two distinct shapes). Requires the Go/Java CLIs to already be built; this doesn't attempt to build them.

## Module formats & compatibility

`@wbd/labs-sdk-ts` is a dual-format package: it works out of the box for CommonJS, ES module, and browser-bundler consumers via the package `exports` map — no consumer-side transpiler step or Jest `transformIgnorePatterns` workaround required. Import from the package root; each consumer automatically resolves the correct artifact:

| Consumer                                  | Resolves to             | Notes                                                                           |
| ----------------------------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| CommonJS (`require`)                      | `dist/index.js`         | Plain CommonJS; `require("@wbd/labs-sdk-ts")` works natively.                   |
| ES module (`import`)                      | `dist/esm/index.mjs`    | True ESM build (bundled, dependencies left external).                           |
| Browser bundler (webpack / rollup / vite) | `dist/labs-sdk-prod.js` | Minified ESM bundle carrying the `Buffer` / `global` polyfills a browser needs. |
| TypeScript                                | `dist/index.d.ts`       | One declaration set shared by all formats.                                      |

```ts
// ES module / TypeScript
import { NewSDK, SDKConfig, DecisionRequest } from "@wbd/labs-sdk-ts";
```

```js
// CommonJS
const { NewSDK } = require("@wbd/labs-sdk-ts");
```

Older resolvers that predate the `exports` field fall back to the top-level `main` / `module` / `browser` fields, which point at the same artifacts, so legacy bundlers keep working. Deep imports (`@wbd/labs-sdk-ts/dist/...`) still resolve for now, but the package root is the only supported surface — prefer it.

## Porting / updating

**Do I need to change anything?** For the common cases, no — this is a drop-in, version-bump-only update. The package moved to a proper dual-format (CommonJS + ESM + browser) publish backed by an `exports` map.

| If you consume the SDK as…                    | Action required                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A browser bundle (webpack / rollup / vite)    | **None.** You resolve the same polyfilled browser bundle as before.                                                                                    |
| CommonJS `require(...)`                       | **None.**                                                                                                                                              |
| Native ESM `import …`                         | **None** — you now get a real ESM build instead of the CommonJS file through interop.                                                                  |
| SSR / Next.js / your own Jest run             | **None** for package-root imports; the Node CJS/ESM conditions above apply.                                                                            |
| Deep imports of internal paths (`.../dist/*`) | Still resolves via a compatibility fallback today; migrate to the package root, as internal paths are unsupported and may be sealed in a future major. |

`getSDKVersion()` now returns the real published version on every entry point (the CommonJS and ESM entries previously returned an un-substituted build placeholder).

## Known gaps vs labs-sdk-go

This SDK targets decision and tracking parity with [`labs-sdk-go`](https://github.com/wbd-streaming/labs-sdk-go) for caller-supplied experiment configs. The following gaps remain:

- **`segment_id` in track payloads** — the Go SDK populates `segment_id` on auto-tracked events from `experiment.segments[0]`. This SDK does not yet include `segment_id` in track payloads (see `TODO` in `src/internal/tracker.ts`).
- **Bulk/project-level flag decisions** (Go's `GetDecisionsByProject`) — `FlagStore.getByProject` exists internally (used by the by-project cache), but there is no public bulk-decision API yet; deferred to a follow-up.

## API Usage

The SDK exports and SDK factory object and two top level functions.

```
/// SETUP
import { NewSDK, SDKConfig, DecisionRequest } from "@wbd/labs-sdk-ts";
const config: SDKConfig = {
  experimentIds: ["UUID-UUID-UUID"],
  fetchUrl: "", // pretend we already have an experiment config
  trackUrl: "https://int.api.discomax.com/labs/api/v1/decision/track",
}
const expConfigs = []; // experiment configurations array
const sdk = NewSDK(config, expConfigs)

/// USAGE
const request: DecisionRequest = {
  experimentId: "GUID-OFMY-EXPERIMENT",
  seedId: "ProfileId, UserId, Something connecting this 'instance' of the experiment",
  context: { platform: "web", userId: "user123" }
}
const decision = sdk.getDecision(request)
if (decision.active && decision.status == success)
{
  // experiment is active, running, and bucketed into control or a treatment
  // decision is automatically tracked with the provided context
} else {
  // Either not active, or an error. 'decision.message' will have info if error
  // Remaining decision data will be set to 'control' settings
}
```

Additionally there is a `getDecisions()` methods if it is desirable to retrieve multiple decisions from the same context/seedid at once.

There are also `Deferred` versions of these decision APIs. Instead of tracking a decision at the time the decision is made, these methods return a callback function. When it is determined the experiment is underway the callback can be used to trigger the tracking event for future analytics.

### Deferred Tracking with Context Overrides

The deferred track callback supports an optional `contextOverrides` parameter that allows you to modify or add context values at tracking time:

```typescript
const deferredDecision = sdk.getDeferredDecision(request);

// Later, when ready to track with additional context
deferredDecision.track({
  customKey: "customValue",
  anotherKey: "anotherValue",
});
```

The SDK intelligently tracks only actual value changes - if you override a context key with the same value it already had, it won't be recorded as an override. Context values are compared using deep equality, including order-independent array comparison.

Note that when retrieving multiple decisions with `getDeferredDecisions()`, the callback takes an experiment id as the first parameter and optional contextOverrides as the second parameter:

```typescript
const deferredDecisions = sdk.getDeferredDecisions(requests);

// Track specific experiment with context overrides
deferredDecisions.track("experiment-id", { newKey: "newValue" });
```

## fetchUrl / trackUrl shorthand: `environment`

Instead of hand-typing the Internet URLs below, `SDKConfig.environment` (`"prod" | "stage" | "int" | "dev"`) resolves both `fetchUrl` and `trackUrl` from a lookup table built into the SDK itself - not an environment-variable read, so it resolves identically in Node and in a browser bundle:

```typescript
const config: SDKConfig = { environment: "stage", experimentIds: [...] };
```

An explicit `fetchUrl`/`trackUrl`/`flagFetchUrl` always takes precedence over `environment` if both are set; `environment` now resolves all three (verified live against each environment, and matching labs-sdk-go's and java-labs-sdk's own URL templates exactly).

## fetchUrl

fetchUrl for max env will typically be one of:  
in-cluster:  
``

Internet - note the `backoffice.` subdomain, distinct from the flag/track host below:  
`https://backoffice.prd.api.discomax.com/labs/api/v1/debug/experiments // Prod`  
`https://backoffice.stg.api.discomax.com/labs/api/v1/debug/experiments // Stage`  
`https://backoffice.int.api.discomax.com/labs/api/v1/debug/experiments // Int`  
`https://backoffice.dev.api.discomax.com/labs/api/v1/debug/experiments // Dev`

## flagFetchUrl

flagFetchUrl for max env will typically be one of:  
`https://prd.api.discomax.com/labs/api/v1/feature-flags // Prod`  
`https://stg.api.discomax.com/labs/api/v1/feature-flags // Stage`  
`https://int.api.discomax.com/labs/api/v1/feature-flags // Int`  
`https://dev.api.discomax.com/labs/api/v1/feature-flags // Dev`

## trackURL

trackUrl for max env will typically be one of:  
in-cluster:  
`http://labs-decision-api-web-microservice.labs-decision-api.svc.cluster.local:8000/api/v1/decision/track`

Internet:  
`"http://localhost:8000/api/v1/decision/track", // Local Debugging`  
`"https://prd.api.discomax.com/labs/api/v1/track", // Prod`  
`"https://stg.api.discomax.com/labs/api/v1/track", // Stage`  
`"https://int.api.discomax.com/labs/api/v1/track", // Int`  
`"https://dev.api.discomax.com/labs/api/v1/track", // Dev`

## Legacy API

- `export async function getExperimentConfig(config: SDKConfig): Promise<ExperimentConfiguration>`
  This is used to retrieve the configuration for an experiment. It will become deprecated once the core SDK has proper experiment configuration management internally.
  The `config` parameter takes URL of the labs API endpoint to retrieve the configuration from. It also contains the experiment ID for the configuration to retrieve. Note it is an async call.

- _(deprecated)_`export function getExperimentDecision(config: ExperimentConfiguration, request: DecisionRequest): DecisionResponse`
  The input is the `config` returned by `getExperimentConfig()` and a request to be satisfied.
  The `request` takes the experiment ID being queried, and the seedId to be used to identify the user/profile/session of interest. The seedId is a unique identifier for a single experiment test subject/candidate.
  If it is not provided, and random GUID is used. That random GUID is generated for each call that does not specify a seedId. This call will never be async. It will always return a valid Decision - even if that decision is an empty 'control group'. For this reason the `control` field should always be checked to select control logic. This will make the experiment resilient to any issues with the experiment configuration.

  The returned data is a `DecisionResponse` and contains the following fields:

  ````
  export type DecisionResponse = {
    status: DecisionStatus;  // Either 'success' or 'error'
    active: boolean;         // Has the experiment been published/enabled
    treatmentId: GUID;       // Which treatment/variant of the experiment is the user in
    label: string;           // The human readable name associated with the experiment ID
    control: boolean;        // Is the treatment the control group not being
                                experimented on?
    message?: string;        // An error/info message when the API fails, or the
                                experiment is not actuve.
  };```
  ````

---

## Creating additional components

To create additional components within an existing repository...

1. Create directory for `<new-component>` in `labs-sdk-ts`: `mkdir <new-component>`
1. Create and configure an `.omd/<new-component>/now.yaml` file
1. Create a `<new-component>/sonar-project.properties` file configuring the [SonarCloud project](https://docs.sonarcloud.io/advanced-setup/ci-based-analysis/sonarscanner-cli/)
1. Create a `<new-component>/Makefile` with standard built targets (details TBD; stay tuned!)
