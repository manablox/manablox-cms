/**
 * Reconciles config-declared resources into the rows of every environment of every space,
 * under ids derived from space (or environment) and slug, marked `source: 'code'`. Core owns
 * credentials and templates; every other kind comes from a `PluginResourceKind` with
 * `reconcile`, the host's first (see `HostResourceKind`), then the plugins'. Synced in
 * reference order: credentials, the kinds in order, templates, then prune in reverse.
 */

import { isSpaceReady } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories, SpaceEnvironmentRow, SpaceRow } from '@manablox/db';
import { pruneCredentials, syncCredentials } from './credentials.js';
import {
  type HostResourceKind,
  type ResourceEnvironmentContext,
  type ResourceKindPlan,
  type ResourceRowsOf,
  type SyncedResourceKind,
  syncedResourceKinds,
} from './kinds.js';
import {
  declaredFor,
  planSpace,
  type SpaceDeclarations,
  type SpaceRows,
  targeting,
} from './plan.js';
import {
  type CodeResourceServices,
  codeScopeKey,
  codeTemplateId,
  type SyncChange,
  type SyncOptions,
  type SyncReport,
} from './shared.js';
import { pruneTemplates, syncTemplates } from './templates.js';

export {
  byEnvironment,
  type ConfigExportContext,
  type ConfigExportRow,
  type ConfigRenderContext,
  defineResourceKind,
  type HostResourceKind,
  type ResourceConfigExport,
  type ResourceEnvironmentContext,
  type ResourceKindPlan,
  type ResourceLoadContext,
  type ResourcePassContext,
  type ResourceRowsOf,
} from './kinds.js';
export type { PlannedCredential, ResourcePlan } from './plan.js';
export { type ResourceReconciler, reconcile as reconcileResources } from './reconcile.js';
export {
  CODE_ACTOR,
  type CodeResourceServices,
  codeCredentialId,
  codeTemplateId,
  entry as syncEntry,
  reasonOf,
  type SyncAction,
  type SyncChange,
  type SyncOptions,
  type SyncReport,
  sameShape,
} from './shared.js';

/** Taken before reconciling, so concurrent boots write once. */
const SYNC_LOCK = 'manablox_code_resources';

/** One environment's rows of every kind, read once per pass. */
interface EnvironmentRows {
  core: SpaceRows;
  kinds: Map<string, unknown>;
}

export class CodeResourceService {
  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    private readonly services: CodeResourceServices,
    /** Kinds the host reconciles besides credentials, templates and the plugins' kinds. */
    private readonly hostKinds: readonly HostResourceKind[] = [],
  ) {}

  /** Reconciles every covered space, serialised across processes. */
  async sync(options: SyncOptions = {}): Promise<SyncReport> {
    const declared = this.manablox.config.resources;
    const kinds = syncedResourceKinds(this.manablox, this.hostKinds);
    const nothing =
      declared.credentials.length +
        declared.templates.length +
        kinds.reduce((sum, kind) => sum + kind.entries(declared).length, 0) ===
      0;

    const spaces = await this.spacesFor(options.spaceIds);
    if (nothing && !options.prune) {
      return { dryRun: options.dryRun ?? false, spaces: spaces.length, changes: [] };
    }

    const run = async (): Promise<SyncReport> => {
      const rows = await this.load(spaces, kinds);
      const changes: SyncChange[] = [];
      // Spaces and environments stay in order so writes and audit entries land deterministically.
      for (const space of spaces) {
        for (const environment of rows.get(space.id) ?? []) {
          changes.push(...(await this.syncSpace(space, environment, kinds, options)));
        }
      }
      return { dryRun: options.dryRun ?? false, spaces: spaces.length, changes };
    };

    // A dry run writes nothing, so it takes no lock.
    return options.dryRun ? run() : this.repos.locks.withLock(SYNC_LOCK, run);
  }

  private async spacesFor(spaceIds: string[] | undefined): Promise<SpaceRow[]> {
    // A space still importing is left alone.
    const all = (await this.repos.spaces.list()).filter(isSpaceReady);
    if (!spaceIds) return all;
    const wanted = new Set(spaceIds);
    return all.filter((space) => wanted.has(space.id));
  }

  /**
   * Every environment's rows in batched queries, keyed by space id, production first;
   * independent of template count.
   */
  private async load(
    spaces: SpaceRow[],
    kinds: SyncedResourceKind[],
  ): Promise<Map<string, EnvironmentRows[]>> {
    const spaceIds = spaces.map((space) => space.id);
    const context = { manablox: this.manablox, repos: this.repos, spaces };
    const [environments, credentials, code, lookups] = await Promise.all([
      this.repos.environments.listBySpaces(spaceIds),
      this.repos.credentials.listBySpaces(spaceIds),
      this.repos.content.listCodeBySpaces(spaceIds, 'all'),
      Promise.all(
        kinds.map(
          async (kind): Promise<ResourceRowsOf<unknown>> =>
            kind.spec.load ? kind.spec.load(context) : () => undefined,
        ),
      ),
    ]);
    const declared = new Map(
      spaces.map((space) => [space.id, declaredFor(this.manablox.config.resources, space)]),
    );
    const templateIds = spaces.flatMap((space) =>
      (environments.get(space.id) ?? []).flatMap((environment) =>
        (declared.get(space.id)?.templates ?? []).flatMap((definition) =>
          space.locales.map((locale) =>
            codeTemplateId(codeScopeKey(space, environment), definition.slug, locale),
          ),
        ),
      ),
    );
    const templates = await this.repos.content.listByIds(templateIds);
    const templatesById = new Map(templates.map((row) => [row.id, row]));
    return new Map(
      spaces.map((space) => [
        space.id,
        (environments.get(space.id) ?? []).map((environment) => ({
          core: {
            declared: declared.get(space.id) as SpaceDeclarations,
            environment,
            key: codeScopeKey(space, environment),
            credentials: credentials.get(space.id) ?? [],
            codeContent: (code.get(space.id) ?? []).filter(
              (row) => row.environmentId === environment.id,
            ),
            templates: templatesById,
          },
          kinds: new Map(
            kinds.map((kind, index) => [kind.kind, lookups[index]?.(space, environment)]),
          ),
        })),
      ]),
    );
  }

  private async syncSpace(
    space: SpaceRow,
    rows: EnvironmentRows,
    kinds: SyncedResourceKind[],
    options: SyncOptions,
  ): Promise<SyncChange[]> {
    const { manablox, repos } = this;
    const services = this.services;
    const { core } = rows;
    const environment: SpaceEnvironmentRow = core.environment;
    const production = environment.kind === 'production';
    const contexts = kinds.map(
      (kind): ResourceEnvironmentContext => ({
        manablox,
        repos,
        services,
        space,
        environment,
        key: core.key,
        declared: targeting(kind.entries(manablox.config.resources), space),
        rows: rows.kinds.get(kind.kind),
      }),
    );
    // Every kind plans before anything is written, so references resolve in any order.
    const parts = new Map<string, ResourceKindPlan>(
      kinds.flatMap((kind, index) => {
        const planned = kind.spec.plan?.(contexts[index] as ResourceEnvironmentContext);
        return planned ? [[kind.kind, planned] as const] : [];
      }),
    );
    const plan = planSpace(space, core, services.credentials, manablox, parts);
    // Kinds get the prune choice resolved against the instance default.
    const passOptions = { ...options, prune: options.prune ?? manablox.config.resources.prune };
    const pass = (index: number) => ({
      ...(contexts[index] as ResourceEnvironmentContext),
      options: passOptions,
      plan,
    });

    const changes: SyncChange[] = [];
    // Credentials are shared by the space's environments.
    if (production) {
      changes.push(
        ...(await syncCredentials(
          { repos, services },
          space,
          core,
          core.declared.credentials,
          options,
        )),
      );
    }
    for (const [index, kind] of kinds.entries()) {
      changes.push(...(await kind.spec.reconcile(pass(index))));
    }
    changes.push(...(await syncTemplates({ manablox, services }, space, core, plan, options)));
    // Referencing kinds first: a later kind's rows may be what an earlier one points at.
    for (const [index, kind] of [...kinds.entries()].reverse()) {
      if (kind.spec.prune) changes.push(...(await kind.spec.prune(pass(index))));
    }
    changes.push(...(await pruneCredentials({ repos }, space, core, options)));
    changes.push(...(await pruneTemplates({ repos }, space, core, options)));
    if (production) return changes;
    return changes.map((change) => ({ ...change, environment: environment.machineName }));
  }
}
