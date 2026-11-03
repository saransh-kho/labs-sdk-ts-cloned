import { ExperimentConfiguration, ExperimentConfigurations, SDKConfig } from "./types";
import { FetchOptions, fetchEnvelopeData } from "./internal/http";
import { resolveConfigUrls } from "./internal/environment-urls";

// Fetches a single experiment config. Throws NotFoundError (an Error
// subclass, so existing callers relying on generic Error handling are
// unaffected) when the upstream response has no config for the given id -
// this lets the self-loading cache (internal/experiment-store.ts) distinguish
// "confirmed not found" from a transient fetch failure.
export async function fetchOneExperimentConfig(
  fetchUrl: string,
  experimentId: string,
  options?: FetchOptions,
): Promise<ExperimentConfiguration> {
  return fetchEnvelopeData<ExperimentConfiguration>(
    `${fetchUrl}/${experimentId}`,
    `no config found for experiment id: ${experimentId}`,
    options,
  );
}

export async function getExperimentConfigs(config: SDKConfig): Promise<ExperimentConfigurations> {
  const resolved = resolveConfigUrls(config);
  const { experimentIds, fetchUrl } = resolved;
  const options: FetchOptions = { timeoutMs: resolved.requestTimeoutMs, fetchFn: resolved.fetchFn };
  // Fetch in parallel (order preserved by Promise.all); a single not-found or
  // fetch failure rejects the whole call, same as the prior sequential loop.
  return Promise.all(experimentIds.map((id) => fetchOneExperimentConfig(fetchUrl, id, options)));
}
