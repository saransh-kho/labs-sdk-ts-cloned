import { FeatureFlag } from "./types";
import { FetchOptions, fetchEnvelopeData } from "./internal/http";

export async function fetchFeatureFlag(
  flagFetchUrl: string,
  flagId: string,
  options?: FetchOptions,
): Promise<FeatureFlag> {
  return fetchEnvelopeData<FeatureFlag>(
    `${flagFetchUrl}/${flagId}`,
    `no flag found for id: ${flagId}`,
    options,
  );
}

export async function fetchFeatureFlagByKey(
  flagFetchUrl: string,
  projectId: string,
  key: string,
  options?: FetchOptions,
): Promise<FeatureFlag> {
  return fetchEnvelopeData<FeatureFlag>(
    `${flagFetchUrl}/project/${projectId}/key/${key}`,
    `no flag found for project ${projectId} key ${key}`,
    options,
  );
}

export async function fetchFeatureFlagsByProject(
  flagFetchUrl: string,
  projectId: string,
  options?: FetchOptions,
): Promise<FeatureFlag[]> {
  return fetchEnvelopeData<FeatureFlag[]>(
    `${flagFetchUrl}/project/${projectId}`,
    `no flags found for project: ${projectId}`,
    options,
  );
}
