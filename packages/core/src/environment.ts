/** Every space has exactly one `production` environment; the others are `staging`. */
export const ENVIRONMENT_KINDS = ['production', 'staging'] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

/** Machine name of every space's production environment. */
export const PRODUCTION_ENVIRONMENT = 'production';

/** Picks a management request's environment by machine name; production when absent. */
export const ENVIRONMENT_HEADER = 'x-manablox-environment';

/** What a new environment was copied with: config only, or config and content. */
export type EnvironmentCreateMode = 'config' | 'full';

/** One environment of one space; environment-scoped rows carry both ids. */
export interface SpaceScope {
  spaceId: string;
  environmentId: string;
}

/** A space id alone means the space's production environment. */
export type Scope = string | SpaceScope;

/** A scope that knows its environment: what request resolution hands the services. */
export interface ResolvedScope extends SpaceScope {
  machineName: string;
  production: boolean;
}

/** The space of a scope. */
export function scopeSpaceId(scope: Scope): string {
  return typeof scope === 'string' ? scope : scope.spaceId;
}

/** The scope of an environment-scoped row. */
export function scopeOf(row: { spaceId: string; environmentId: string }): SpaceScope {
  return { spaceId: row.spaceId, environmentId: row.environmentId };
}

/**
 * Whether a row belongs to `scope`: its space, and its environment when `scope` names one.
 * Rows without an environment (shared ones) only need the space.
 */
export function inScope(
  row: { spaceId: string | null; environmentId?: string | null | undefined },
  scope: Scope,
): boolean {
  if (typeof scope === 'string') return row.spaceId === scope;
  if (row.spaceId !== scope.spaceId) return false;
  return row.environmentId == null || row.environmentId === scope.environmentId;
}

/** The staging environment id of a resolved scope; `null` in production or for a space id. */
export function stagingIdOf(scope: string | ResolvedScope | null | undefined): string | null {
  return scope && typeof scope !== 'string' && !scope.production ? scope.environmentId : null;
}

/** A staging environment's space-wide cache tag; production keeps `space:<id>`. */
export function environmentCacheTag(spaceId: string, environmentId: string): string {
  return `space:${spaceId}:env:${environmentId}`;
}

/** The space-wide tag a write in the scope purges: the environment's for staging. */
export function spacePurgeTag(scope: string | ResolvedScope): string {
  const staging = stagingIdOf(scope);
  const spaceId = scopeSpaceId(scope);
  return staging ? environmentCacheTag(spaceId, staging) : `space:${spaceId}`;
}

/** A scope's home document. */
export interface EnvironmentNominations {
  homeContentId: string | null;
}

/**
 * A document an environment names, e.g. its home page. Core's live in `spaces.settings`:
 * production's under a key of the nomination's own, a staging environment's under
 * `environments.<id>.<key>`. A plugin's live in its settings rows: production's through
 * `read` and `write`, a staging environment's at `key` of that environment's row.
 */
export interface EnvironmentNomination {
  /** The key under `environments.<environmentId>`, or in a staging plugin row. */
  key: string;
  /** The plugin id whose settings hold it; core's when absent. */
  plugin?: string;
  /** Production's document. */
  read(settings: Record<string, unknown>): string | null;
  /** `settings` with production's document set; `null` clears it. */
  write(settings: Record<string, unknown>, id: string | null): Record<string, unknown>;
}

const text = (value: unknown) => (typeof value === 'string' ? value : null);

/** The home page, `homeContentId` in production. */
export const HOME_NOMINATION: EnvironmentNomination = {
  key: 'homeContentId',
  read: (settings) => text(settings.homeContentId),
  write: (settings, id) => {
    const { homeContentId: _home, ...rest } = settings;
    return id ? { ...rest, homeContentId: id } : rest;
  },
};

/** An environment's document for `nomination`; `stagingId` null is production. */
export function nominationOf(
  settings: Record<string, unknown> | null | undefined,
  stagingId: string | null,
  nomination: EnvironmentNomination,
): string | null {
  if (!settings) return null;
  if (!stagingId) return nomination.read(settings);
  const own = (settings.environments as Record<string, Record<string, unknown>> | undefined)?.[
    stagingId
  ];
  return text(own?.[nomination.key]);
}

/** The home nomination of an environment. */
export function nominationsOf(
  settings: Record<string, unknown> | null | undefined,
  stagingId: string | null,
): EnvironmentNominations {
  return { homeContentId: nominationOf(settings, stagingId, HOME_NOMINATION) };
}

/** `settings` with a staging environment's nominations changed by key; `null` clears one. */
export function withStagingNominations(
  settings: Record<string, unknown>,
  stagingId: string,
  patch: Readonly<Record<string, string | null | undefined>>,
): Record<string, unknown> {
  const all = { ...((settings.environments as Record<string, Record<string, unknown>>) ?? {}) };
  const own: Record<string, unknown> = { ...(all[stagingId] ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value) own[key] = value;
    else delete own[key];
  }
  if (Object.keys(own).length) all[stagingId] = own;
  else delete all[stagingId];
  const { environments: _environments, ...rest } = settings;
  return Object.keys(all).length ? { ...rest, environments: all } : rest;
}
