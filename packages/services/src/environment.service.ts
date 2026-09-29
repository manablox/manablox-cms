import { type LocalCache, localCache } from '@manablox/cache';
import {
  featureDenied,
  ManabloxError,
  PRODUCTION_ENVIRONMENT,
  type ResolvedScope,
  type Scope,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories, SpaceEnvironmentRow } from '@manablox/db';

export type { SpaceEnvironmentRow };

/** Production environments kept in process, least recently used first out. */
const PRODUCTIONS_KEPT = 10_000;
/** A production row changes only with its space, whose purge drops it; this bounds a miss. */
const PRODUCTION_TTL_MS = 10 * 60_000;

const SPACE_TAG = 'space:';

/** Who asks for an environment: an API key may be limited to some. */
export interface EnvironmentRequester {
  allowedEnvironmentIds?: readonly string[] | null | undefined;
}

/**
 * Resolves a space's environments. `production` is kept in process (an LRU, see
 * `localCache`) until the space's `space:<id>` cache tag is purged, here or in another
 * process.
 */
export class EnvironmentService {
  private readonly productions: LocalCache<SpaceEnvironmentRow>;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
  ) {
    this.productions = localCache(manablox, { max: PRODUCTIONS_KEPT, ttlMs: PRODUCTION_TTL_MS });
    // Also without `attachCache` (bare service setups): this process's purges.
    manablox.hooks.on(
      'cache:purge',
      ({ tags }) =>
        this.productions.purge(
          tags.filter((tag) => tag.startsWith(SPACE_TAG) && !tag.includes(':env:')),
        ),
      { source: 'environments' },
    );
  }

  /** The space's production environment. */
  production(spaceId: string): Promise<SpaceEnvironmentRow> {
    return this.productions.load(spaceId, async () => {
      const row = await this.repos.environments.production(spaceId);
      if (!row) throw ManabloxError.notFound('space.notFound', { spaceId });
      return { value: row, tags: [`${SPACE_TAG}${spaceId}`] };
    });
  }

  /** The space's environments, production first. */
  list(spaceId: string): Promise<SpaceEnvironmentRow[]> {
    return this.repos.environments.listBySpace(spaceId);
  }

  /** The scope of an environment by machine name; production when `machineName` is absent. */
  async scope(spaceId: string, machineName?: string | null): Promise<ResolvedScope> {
    if (!machineName || machineName === PRODUCTION_ENVIRONMENT) {
      const row = await this.production(spaceId);
      return { spaceId, environmentId: row.id, machineName: row.machineName, production: true };
    }
    const row = await this.repos.environments.findByMachineName(spaceId, machineName);
    if (!row) throw ManabloxError.notFound('environment.notFound', { spaceId, machineName });
    return {
      spaceId,
      environmentId: row.id,
      machineName: row.machineName,
      production: row.kind === 'production',
    };
  }

  /** A scope with its environment's machine name and kind; unknown ones are not found. */
  async resolve(scope: Scope): Promise<ResolvedScope> {
    if (typeof scope === 'string') return this.scope(scope);
    const resolved = await this.repos.environments.resolve(scope);
    if (!resolved) {
      throw ManabloxError.notFound('environment.notFound', { environmentId: scope.environmentId });
    }
    return resolved;
  }

  /**
   * A request's environment by machine name. Besides production it needs the `environments`
   * feature; an API key limited to other environments is refused.
   */
  async forRequest(
    spaceId: string,
    machineName?: string | null,
    requester?: EnvironmentRequester | null,
  ): Promise<ResolvedScope> {
    const scope = await this.scope(spaceId, machineName);
    await this.admit(scope, requester);
    return scope;
  }

  /** The checks `forRequest` runs, for a scope resolved elsewhere (a host, a share link). */
  async admit(scope: ResolvedScope, requester?: EnvironmentRequester | null): Promise<void> {
    if (!scope.production) {
      const feature = await this.manablox.controls.feature(scope.spaceId, 'environments');
      if (!feature.enabled) throw featureDenied('environments', feature);
    }
    const allowed = requester?.allowedEnvironmentIds;
    if (allowed && !allowed.includes(scope.environmentId)) {
      throw ManabloxError.forbidden('environment.forbidden', { environment: scope.machineName });
    }
  }
}
