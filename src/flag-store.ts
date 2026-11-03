import { FeatureFlag } from "./types";
import { AsyncCache, CacheTraceEvent } from "./internal/cache";
import { fetchFeatureFlag, fetchFeatureFlagByKey, fetchFeatureFlagsByProject } from "./flag-loader";
import { FetchOptions } from "./internal/http";
import { ResolvedSDKConfig } from "./internal/environment-urls";

export type FlagCacheEventSink = (store: string, event: CacheTraceEvent) => void;

function compositeKey(projectId: string, key: string): string {
  return `${projectId}:${key}`;
}

// Three separate AsyncCache instances (not Go's one string-multiplexed
// byte-blob cache - Java already moved to this shape in CachingFlagStore for
// reference-identity/type-safety reasons, and it fits Task 1's typed-cache
// design better than reintroducing string-key multiplexing):
//   - byId: the single source of truth for a loaded FeatureFlag object.
//   - aliasByKey: projectId:key -> flag uuid, resolved then routed through
//     byId so there is only ever one copy of a given flag's data.
//   - idsByProject: projectId -> flag uuids, same hydrate-through pattern.
export class FlagStore {
  private byId: AsyncCache<string, FeatureFlag>;
  private aliasByKey: AsyncCache<string, string>;
  private idsByProject: AsyncCache<string, string[]>;

  constructor(
    private config: ResolvedSDKConfig,
    onEvent?: FlagCacheEventSink,
  ) {
    const flagFetchUrl = config.flagFetchUrl ?? config.fetchUrl;
    const fetchOptions: FetchOptions = { timeoutMs: config.requestTimeoutMs, fetchFn: config.fetchFn };

    this.byId = new AsyncCache<string, FeatureFlag>(
      config.flagCacheSettings ?? {},
      (id) => fetchFeatureFlag(flagFetchUrl, id, fetchOptions),
      (event) => onEvent?.("flag", event),
    );

    this.aliasByKey = new AsyncCache<string, string>(
      config.flagCacheSettings ?? {},
      async (composite) => {
        const [projectId, key] = FlagStore._splitCompositeKey(composite);
        const flag = await fetchFeatureFlagByKey(flagFetchUrl, projectId, key, fetchOptions);
        this.byId.set(flag.uuid, flag); // hydrate byId directly, avoiding a second round trip
        return flag.uuid;
      },
      (event) => onEvent?.("flag-alias", event),
    );

    this.idsByProject = new AsyncCache<string, string[]>(
      config.flagProjectCacheSettings ?? config.flagCacheSettings ?? {},
      async (projectId) => {
        const flags = await fetchFeatureFlagsByProject(flagFetchUrl, projectId, fetchOptions);
        for (const flag of flags) {
          this.byId.set(flag.uuid, flag); // hydrate byId for every flag in the bulk response
        }
        return flags.map((flag) => flag.uuid);
      },
      (event) => onEvent?.("flag-project", event),
    );
  }

  private static _splitCompositeKey(composite: string): [string, string] {
    const separatorIndex = composite.indexOf(":");
    return [composite.slice(0, separatorIndex), composite.slice(separatorIndex + 1)];
  }

  async getById(flagId: string): Promise<FeatureFlag | undefined> {
    try {
      return await this.byId.getOrLoad(flagId);
    } catch {
      return undefined;
    }
  }

  async getByKey(projectId: string, key: string): Promise<FeatureFlag | undefined> {
    try {
      const flagId = await this.aliasByKey.getOrLoad(compositeKey(projectId, key));
      return await this.getById(flagId);
    } catch {
      return undefined;
    }
  }

  // NYI: not yet wired to a public SDK method. This backs a future
  // getDecisionsByProject() - bulk flag decisions for an entire project - for
  // parity with labs-sdk-go's GetDecisionsByProject and java-labs-sdk's
  // equivalent. The three-cache plumbing (idsByProject -> byId hydrate-through)
  // is already in place; only the public decision-fanout method is missing.
  async getByProject(projectId: string): Promise<FeatureFlag[]> {
    try {
      const ids = await this.idsByProject.getOrLoad(projectId);
      const flags = await Promise.all(ids.map((id) => this.getById(id)));
      return flags.filter((flag): flag is FeatureFlag => flag !== undefined);
    } catch {
      return [];
    }
  }

  // Optional static warmup: flags are naturally lazy/on-demand (unlike
  // experiments, which need eager program-holdout parent prefetch), so this
  // only prefetches a configured flagIds seed list, if any, and never rejects.
  async warmup(): Promise<void> {
    const flagIds = this.config.flagIds ?? [];
    await Promise.all(flagIds.map((id) => this.getById(id)));
  }

  stop(): void {
    this.byId.stop();
    this.aliasByKey.stop();
    this.idsByProject.stop();
  }
}
