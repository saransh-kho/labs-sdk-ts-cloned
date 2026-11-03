import { Environment, SDKConfig } from "../types";

// A pure lookup table, not an env-var read - this is what lets "environment"
// resolve identically in both the Node build and the browser bundle. There
// is no runtime process.env in a browser bundle (only build-time
// substitution via the consumer's own bundler, which this SDK doesn't
// control), so any Node-only env-var fallback would silently not work in
// half of what this package ships.
// Verified live against each real environment (not just transcribed from
// docs - the experiment host in particular differs from a same-named
// non-"backoffice." host that 404s on every id). Matches labs-sdk-go's
// cmd/labs-cli/env.go and java-labs-sdk's tools/labs-cli EnvironmentConfig
// templates exactly, which independently agree on all three hosts.
export const EnvironmentUrls: Record<
  Environment,
  { fetchUrl: string; trackUrl: string; flagFetchUrl: string }
> = {
  prod: {
    fetchUrl: "https://backoffice.prd.api.discomax.com/labs/api/v1/debug/experiments",
    trackUrl: "https://prd.api.discomax.com/labs/api/v1/track",
    flagFetchUrl: "https://prd.api.discomax.com/labs/api/v1/feature-flags",
  },
  stage: {
    fetchUrl: "https://backoffice.stg.api.discomax.com/labs/api/v1/debug/experiments",
    trackUrl: "https://stg.api.discomax.com/labs/api/v1/track",
    flagFetchUrl: "https://stg.api.discomax.com/labs/api/v1/feature-flags",
  },
  int: {
    fetchUrl: "https://backoffice.int.api.discomax.com/labs/api/v1/debug/experiments",
    trackUrl: "https://int.api.discomax.com/labs/api/v1/track",
    flagFetchUrl: "https://int.api.discomax.com/labs/api/v1/feature-flags",
  },
  dev: {
    fetchUrl: "https://backoffice.dev.api.discomax.com/labs/api/v1/debug/experiments",
    trackUrl: "https://dev.api.discomax.com/labs/api/v1/track",
    flagFetchUrl: "https://dev.api.discomax.com/labs/api/v1/feature-flags",
  },
};

// fetchUrl/trackUrl are guaranteed present (not just optional-in-the-type)
// after resolveConfigUrls runs. flagFetchUrl stays optional here even though
// the env table always supplies one when `environment` is set - an explicit
// fetchUrl-only config (no `environment`) still has no way to derive it.
export type ResolvedSDKConfig = SDKConfig & { fetchUrl: string; trackUrl: string };

// Explicit fetchUrl/trackUrl/flagFetchUrl always win over `environment` when
// both are given. Throws if neither an explicit URL nor `environment` can
// resolve fetchUrl/trackUrl - this is a construction-time configuration
// error, not a runtime one. flagFetchUrl has no equivalent throw: it's
// genuinely optional (flag-store.ts falls back to fetchUrl when absent).
export function resolveConfigUrls(config: SDKConfig): ResolvedSDKConfig {
  const envUrls = config.environment ? EnvironmentUrls[config.environment] : undefined;
  const fetchUrl = config.fetchUrl ?? envUrls?.fetchUrl;
  const trackUrl = config.trackUrl ?? envUrls?.trackUrl;
  const flagFetchUrl = config.flagFetchUrl ?? envUrls?.flagFetchUrl;

  if (fetchUrl === undefined) {
    throw new Error("SDKConfig requires either fetchUrl or environment to be set");
  }
  if (trackUrl === undefined) {
    throw new Error("SDKConfig requires either trackUrl or environment to be set");
  }

  return { ...config, fetchUrl, trackUrl, flagFetchUrl };
}
