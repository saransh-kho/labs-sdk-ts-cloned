import { NewSDKFromConfig } from "../sdk";
import { Environment, LabsDecisionTracer, SDKConfig } from "../types";
import { EnvironmentUrls, resolveConfigUrls } from "../internal/environment-urls";
import { CliOptions } from "./args";
import { createStderrTracer, parseTraceLevel } from "./output";

function parseEnvironment(name: string | undefined): Environment | undefined {
  if (name === undefined) {
    return undefined;
  }
  if (!(name in EnvironmentUrls)) {
    throw new Error(`Unknown --env: ${name} (expected one of: ${Object.keys(EnvironmentUrls).join(", ")})`);
  }
  return name as Environment;
}

// The real URLs this config would resolve to - independent of the CLI's own
// null:-sink safety default for trackUrl, so --show-config always shows what
// --env/--fetch-url/--track-url actually mean, not the CLI's opt-in-to-track
// override.
function buildDisplayConfig(options: CliOptions): SDKConfig {
  return {
    environment: parseEnvironment(options.environment),
    fetchUrl: options.fetchUrl,
    trackUrl: options.trackUrl,
    flagFetchUrl: options.flagFetchUrl,
    experimentIds: [],
  };
}

function buildConfig(options: CliOptions): SDKConfig {
  return {
    environment: parseEnvironment(options.environment),
    fetchUrl: options.fetchUrl,
    // Default to a no-op tracking sink - a probing tool should never silently
    // push real analytics events unless the caller explicitly opts in.
    trackUrl: options.track ? options.trackUrl : (options.trackUrl ?? "null:"),
    flagFetchUrl: options.flagFetchUrl,
    experimentIds: options.expId ? [options.expId] : [],
    flagIds: options.flagId ? [options.flagId] : [],
    requestTimeoutMs: options.timeoutMs,
  };
}

export async function runDecision(options: CliOptions): Promise<unknown> {
  if (options.showConfig) {
    const resolved = resolveConfigUrls(buildDisplayConfig(options));
    return {
      environment: options.environment,
      fetchUrl: resolved.fetchUrl,
      trackUrl: resolved.trackUrl,
      flagFetchUrl: resolved.flagFetchUrl ?? resolved.fetchUrl,
      note: "trackUrl shown here is what --track would use; decisions default to a null: sink unless --track is passed.",
    };
  }

  const config = buildConfig(options);

  // Validate eagerly, before any network activity.
  const traceLevel = options.traceLevel !== undefined ? parseTraceLevel(options.traceLevel) : undefined;

  if (!options.context) {
    throw new Error(`--context is required (JSON object, e.g. '{}' or '{"profileId":"p1"}')`);
  }
  const context = JSON.parse(options.context);

  const tracer: LabsDecisionTracer | undefined = traceLevel !== undefined ? createStderrTracer() : undefined;
  const sdk = await NewSDKFromConfig(config, tracer);
  if (tracer && traceLevel !== undefined) {
    sdk.setTraceLevel(traceLevel);
    sdk.setTraceListener(tracer);
  }

  try {
    if (options.flagKey) {
      if (!options.projectId) {
        throw new Error("--flag-key requires --project-id");
      }
      return await sdk.getDecisionByKey({
        projectId: options.projectId,
        key: options.flagKey,
        seedId: options.seed,
        context,
      });
    }
    if (options.flagId) {
      return await sdk.getFlagDecision({ flagId: options.flagId, seedId: options.seed, context });
    }
    if (options.expId) {
      return sdk.getDecision({ experimentId: options.expId, seedId: options.seed ?? "", context });
    }
    throw new Error("specify --exp-id, --flag-id, or --flag-key (with --project-id)");
  } finally {
    sdk.stop();
  }
}
