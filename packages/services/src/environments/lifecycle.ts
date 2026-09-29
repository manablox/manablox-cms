import { randomUUID } from 'node:crypto';
import {
  type AnyLimitKey,
  auditor,
  type ContentTypeKind,
  type EnvironmentCreateMode,
  environmentCacheTag,
  isMachineName,
  ManabloxError,
  PRODUCTION_ENVIRONMENT,
  purgeTags,
  redirectsCacheTag,
  TEMPLATE_TYPE_NAME,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories, SpaceEnvironmentRow, TransactionRepositories } from '@manablox/db';
import type { ContentTypeService } from '../content-type.service.js';
import type { PromoteLocks } from '../controls/promote-lock.js';
import {
  environmentProviders,
  hostSources,
  notifyLiveChange,
  providerCacheTags,
} from '../data/registry.js';
import { SpaceNominations } from '../nominations.js';
import type { SnapshotService } from '../snapshots/service.js';
import { copyIds, type EnvironmentCopyCounts, writeCopy } from './copy.js';
import { type EnvironmentData, loadEnvironment } from './data.js';
import { diffPlan, type EnvironmentDiff } from './diff.js';
import type { IdMap } from './ids.js';
import { type PromotePlan, planPromote, promoteIds } from './plan.js';
import { applyPromote, type PromoteGroupResult } from './promote.js';

export interface EnvironmentLifecycleOptions {
  /** Reloads the registry after types were copied, promoted or deleted. */
  contentTypes: Pick<ContentTypeService, 'reload'>;
  /** Takes a snapshot of production before a promote when snapshots are on. */
  snapshots?: Pick<SnapshotService, 'supported' | 'create'> | null | undefined;
  /** Runs once a new environment is committed, e.g. to sync code resources into it. */
  afterCreate?: ((spaceId: string) => Promise<void>) | undefined;
  /** Refuses production writes of the space while a promote runs. */
  promotes?: Pick<PromoteLocks, 'hold'> | null | undefined;
}

export interface EnvironmentCreateInput {
  /** The environment to copy; production when absent. */
  from?: string | null | undefined;
  machineName: string;
  name: string;
  mode: EnvironmentCreateMode;
}

export interface EnvironmentCreateResult {
  environment: SpaceEnvironmentRow;
  copied: EnvironmentCopyCounts;
}

export interface EnvironmentPromoteResult {
  environment: string;
  mode: EnvironmentCreateMode;
  /** `partial`: a group failed after others were applied. */
  status: 'applied' | 'partial' | 'failed';
  /** The snapshot of production taken first; `null` without snapshots. */
  snapshot: string | null;
  groups: PromoteGroupResult[];
  diff: EnvironmentDiff;
}

type Target = Pick<SpaceEnvironmentRow, 'id' | 'spaceId' | 'name'>;

/**
 * Creates staging environments as copies, promotes one into production and deletes them.
 * Callers check `environment:manage`.
 */
export class EnvironmentLifecycleService {
  private readonly audit;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    private readonly options: EnvironmentLifecycleOptions,
  ) {
    this.audit = auditor(repos, 'environment', (row: Target) => row.name);
  }

  /** The space's environments, production first. */
  async list(spaceId: string): Promise<SpaceEnvironmentRow[]> {
    await this.requireSpace(spaceId);
    return this.repos.environments.listBySpace(spaceId);
  }

  /** Copies an environment into a new staging one: config only, or config and content. */
  async create(spaceId: string, input: EnvironmentCreateInput): Promise<EnvironmentCreateResult> {
    await this.requireSpace(spaceId);
    await this.manablox.controls.assertFeature(spaceId, 'environments');
    if (!isMachineName(input.machineName) || input.machineName === PRODUCTION_ENVIRONMENT) {
      throw ManabloxError.badRequest('environment.machineName.invalid', {
        machineName: input.machineName,
      });
    }
    const source = await this.require(spaceId, input.from ?? PRODUCTION_ENVIRONMENT);

    const result = await this.locked(spaceId, async () => {
      if (await this.repos.environments.findByMachineName(spaceId, input.machineName)) {
        throw ManabloxError.conflict('environment.machineName.taken', {
          machineName: input.machineName,
        });
      }
      await this.manablox.controls.assertLimit(spaceId, 'environmentsPerSpace');
      return this.repos.transaction(async (tx) => {
        const environment = await tx.environments.create({
          id: randomUUID(),
          spaceId,
          machineName: input.machineName,
          name: input.name,
          kind: 'staging',
          createdFrom: source.id,
          createdMode: input.mode,
        });
        const data = await loadEnvironment(tx, source.id, {
          content: input.mode === 'full',
          templateTypeId: this.templateTypeId(),
          redirects: 'paths',
          providers: this.providers(spaceId),
        });
        const map = copyIds(data, spaceId, environment.id);
        const copied = await writeCopy(tx, data, map, {
          manablox: this.manablox,
          spaceId,
          from: source,
          to: environment,
          mode: input.mode,
        });
        if (input.mode === 'full') {
          await this.copyNominations(tx, spaceId, source, environment.id, map);
        }
        await this.audit.in(tx).record('environment.create', environment, undefined, {
          environment: environment.machineName,
          from: source.machineName,
          mode: input.mode,
          copied,
        });
        await this.manablox.controls.emit(
          'environment.created',
          { kind: 'space', id: spaceId },
          {
            spaceId,
            environmentId: environment.id,
            machineName: environment.machineName,
            from: source.machineName,
            mode: input.mode,
          },
          { tx },
        );
        await notifyLiveChange(this.manablox, tx, spaceId, 'create');
        return { environment, copied };
      });
    });

    await this.options.contentTypes.reload();
    await this.options.afterCreate?.(spaceId).catch((error: unknown) => {
      this.manablox.logger.warn({ err: error, spaceId }, 'environment not synced after create');
    });
    return result;
  }

  /** What promoting a staging environment would change in production. */
  async diff(
    spaceId: string,
    machineName: string,
    mode: EnvironmentCreateMode,
  ): Promise<EnvironmentDiff> {
    return (await this.prepare(spaceId, machineName, mode)).diff;
  }

  /**
   * Moves a staging environment's config, or config and content, into production, one table
   * group per transaction. A diff that needs confirmation is refused without `confirm`.
   */
  async promote(
    spaceId: string,
    machineName: string,
    mode: EnvironmentCreateMode,
    options: { confirm?: boolean } = {},
  ): Promise<EnvironmentPromoteResult> {
    await this.manablox.controls.assertFeature(spaceId, 'environments');
    const production = await this.require(spaceId, PRODUCTION_ENVIRONMENT);
    const promotes = this.options.promotes;
    const held = <T>(fn: () => Promise<T>) =>
      promotes ? promotes.hold(spaceId, production.id, fn) : fn();
    return this.locked(spaceId, () =>
      held(() => this.promoteLocked(spaceId, machineName, mode, options)),
    );
  }

  private async promoteLocked(
    spaceId: string,
    machineName: string,
    mode: EnvironmentCreateMode,
    options: { confirm?: boolean },
  ): Promise<EnvironmentPromoteResult> {
    const prepared = await this.prepare(spaceId, machineName, mode);
    const { diff, plan, staging, production } = prepared;
    if (diff.confirmRequired && !options.confirm) {
      throw ManabloxError.conflict('environment.promote.confirmRequired', {
        environment: machineName,
        mode,
        breaking: diff.breaking,
      });
    }
    await this.assertLimits(spaceId, plan, prepared.productionData);

    let snapshot: string | null = null;
    const snapshots = this.options.snapshots;
    if (snapshots?.supported && (await this.snapshotsOn(spaceId))) {
      snapshot = (await snapshots.create(spaceId, { trigger: 'promote' })).id;
    }

    const groups = await applyPromote(this.repos, {
      manablox: this.manablox,
      spaceId,
      productionId: production.id,
      stagingId: staging.id,
      environment: machineName,
      plan,
      production: prepared.productionData,
      kindOf: (typeId) => this.kindOf(typeId),
    });
    const applied = groups.filter((group) => group.status === 'applied').length;
    const failed = groups.some((group) => group.status === 'failed');
    const status = !failed ? 'applied' : applied > 0 ? 'partial' : 'failed';

    if (applied > 0) {
      await notifyLiveChange(this.manablox, this.repos, spaceId, 'promote');
      await this.options.contentTypes.reload();
      await purgeTags(this.manablox, spaceId, this.productionTags(spaceId, plan, prepared));
    }
    const summary = {
      environment: machineName,
      mode,
      status,
      snapshot,
      groups: groups.map((group) => `${group.group}:${group.status}`),
    };
    await this.audit.record('environment.promote', staging, undefined, summary);
    await this.manablox.controls.emit(
      'environment.promoted',
      { kind: 'space', id: spaceId },
      { spaceId, environmentId: staging.id, machineName, mode, status, snapshot },
    );
    return { environment: machineName, mode, status, snapshot, groups, diff };
  }

  /** Deletes a staging environment and everything in it; production cannot be deleted. */
  async delete(spaceId: string, machineName: string): Promise<void> {
    const environment = await this.require(spaceId, machineName);
    if (environment.kind === 'production') {
      throw ManabloxError.forbidden('environment.production.undeletable', { machineName });
    }
    await this.locked(spaceId, () =>
      this.repos.transaction(async (tx) => {
        for (const { handler } of environmentProviders(this.manablox)) {
          await handler.remove?.({
            manablox: this.manablox,
            repos: tx,
            spaceId,
            environmentId: environment.id,
          });
        }
        await tx.environments.delete(environment.id);
        // Plugin rows go with the environment.
        const nominations = await SpaceNominations.load(this.manablox, tx, spaceId);
        if (nominations) {
          for (const nomination of nominations.list) {
            if (!nomination.plugin) nominations.set(environment.id, nomination, null);
          }
          await nominations.save(tx);
        }
        await this.audit.in(tx).record('environment.delete', environment, undefined, {
          environment: machineName,
        });
        await this.manablox.controls.emit(
          'environment.deleted',
          { kind: 'space', id: spaceId },
          { spaceId, environmentId: environment.id, machineName },
          { tx },
        );
        await notifyLiveChange(this.manablox, tx, spaceId, 'delete');
      }),
    );
    await this.options.contentTypes.reload();
    await purgeTags(this.manablox, spaceId, [
      environmentCacheTag(spaceId, environment.id),
      ...hostSources(this.manablox).map((source) => source.cacheTag),
    ]);
  }

  /** Reads both environments and plans the promote. */
  private async prepare(spaceId: string, machineName: string, mode: EnvironmentCreateMode) {
    const staging = await this.require(spaceId, machineName);
    if (staging.kind !== 'staging') {
      throw ManabloxError.badRequest('environment.promote.notStaging', { machineName });
    }
    const production = await this.require(spaceId, PRODUCTION_ENVIRONMENT);
    const options = {
      content: mode === 'full',
      templateTypeId: this.templateTypeId(),
      menuItems: mode === 'full',
    };
    const providers = this.providers(spaceId);
    const stagingData = await loadEnvironment(this.repos, staging.id, {
      ...options,
      redirects: 'paths',
      providers,
    });
    const productionData = await loadEnvironment(this.repos, production.id, {
      ...options,
      redirects: 'all',
      providers,
    });
    const input = {
      mode,
      spaceId,
      stagingId: staging.id,
      productionId: production.id,
      lineage: await this.lineage(staging),
      staging: stagingData,
      production: productionData,
      takenTypeIds: new Set([
        ...this.manablox.contentTypes.all.map((type) => type.id),
        ...productionData.contentTypes.map((type) => type.id),
      ]),
    };
    const plan = planPromote(input, promoteIds(input));
    const diff = await diffPlan(this.repos, plan, productionData, production.id, machineName);
    return { staging, production, productionData, plan, diff };
  }

  /**
   * Environment ids from production's direct copy down to `staging`, so copied rows find
   * their source; `null` when the line breaks at a deleted environment.
   */
  private async lineage(staging: SpaceEnvironmentRow): Promise<string[] | null> {
    const line: string[] = [];
    let current: SpaceEnvironmentRow | null = staging;
    while (current && current.kind !== 'production' && line.length < 50) {
      line.unshift(current.id);
      current = current.createdFrom
        ? await this.repos.environments.findById(current.createdFrom)
        : null;
    }
    return current?.kind === 'production' ? line : null;
  }

  /** Count limits production would pass after the promote. */
  private async assertLimits(
    spaceId: string,
    plan: PromotePlan,
    production: EnvironmentData,
  ): Promise<void> {
    const before = new Set(production.contentTypes.map((type) => type.id));
    const added = plan.types.upsert.filter((type) => !before.has(type.id));
    const types = added.filter((type) => type.kind !== 'data').length;
    const databags = added.length - types;
    const menus = plan.menus.upsert.length - production.menus.length;
    const manual = (rows: Array<{ source: string }>) =>
      rows.filter((row) => row.source === 'manual').length;
    const redirects = manual(plan.redirects.upsert) - manual(plan.redirects.remove);
    const increments: Array<[AnyLimitKey, number]> = [
      ['contentTypes', types],
      ['databagTypes', databags],
      ['menusPerSpace', menus],
      ['redirectsPerSpace', redirects],
    ];
    if (plan.mode === 'full') {
      const count = (rows: Array<{ typeId: string }>, kind: ContentTypeKind) =>
        rows.filter((row) => this.kindIn(plan, production, row.typeId) === kind).length;
      increments.push(
        [
          'documents',
          count(plan.documents.contents, 'content') - count(production.contents, 'content'),
        ],
        [
          'databagEntries',
          count(plan.documents.contents, 'data') - count(production.contents, 'data'),
        ],
      );
    }
    for (const { handler, upsert, remove, production: live } of plan.plugins) {
      const limits = handler.limits?.({ upsert, remove, production: live }) ?? {};
      increments.push(...(Object.entries(limits) as Array<[AnyLimitKey, number]>));
    }
    for (const [key, increment] of increments) {
      if (increment > 0) await this.manablox.controls.assertLimit(spaceId, key, { increment });
    }
  }

  private kindIn(
    plan: PromotePlan,
    production: EnvironmentData,
    typeId: string,
  ): ContentTypeKind | undefined {
    const type =
      plan.types.upsert.find((row) => row.id === typeId) ??
      production.contentTypes.find((row) => row.id === typeId);
    return type?.kind ?? this.kindOf(typeId);
  }

  /** Production's cache tags a promote touched. */
  private productionTags(
    spaceId: string,
    plan: PromotePlan,
    prepared: { productionData: EnvironmentData },
  ): string[] {
    return [
      `space:${spaceId}`,
      ...providerCacheTags(this.manablox, spaceId),
      redirectsCacheTag(spaceId),
      ...[...plan.types.upsert, ...plan.types.unmatched].map((type) => `type:${type.id}`),
      ...[...plan.menus.upsert, ...prepared.productionData.menus].map((menu) => `menu:${menu.id}`),
    ].filter((tag, index, all) => all.indexOf(tag) === index);
  }

  private providers(spaceId: string) {
    return { manablox: this.manablox, spaceId, list: environmentProviders(this.manablox) };
  }

  /** The nominations of a full copy's source, pointing at the copied documents. */
  private async copyNominations(
    tx: TransactionRepositories,
    spaceId: string,
    source: SpaceEnvironmentRow,
    targetId: string,
    map: IdMap,
  ): Promise<void> {
    const nominations = await SpaceNominations.load(this.manablox, tx, spaceId);
    if (!nominations) return;
    const stagingId = source.kind === 'production' ? null : source.id;
    for (const nomination of nominations.list) {
      const id = nominations.get(stagingId, nomination);
      if (id && map.has(id)) nominations.set(targetId, nomination, map.id(id));
    }
    await nominations.save(tx);
  }

  private kindOf(typeId: string): ContentTypeKind | undefined {
    return this.manablox.contentTypes.tryGet(typeId)?.kind;
  }

  private templateTypeId(): string | null {
    return this.manablox.contentTypes.tryGetByName(TEMPLATE_TYPE_NAME, null)?.id ?? null;
  }

  private async snapshotsOn(spaceId: string): Promise<boolean> {
    return (await this.manablox.controls.feature(spaceId, 'snapshots')).enabled;
  }

  private async requireSpace(spaceId: string): Promise<void> {
    if (!(await this.repos.spaces.findById(spaceId))) {
      throw ManabloxError.notFound('space.notFound', { spaceId });
    }
  }

  private async require(spaceId: string, machineName: string): Promise<SpaceEnvironmentRow> {
    const row = await this.repos.environments.findByMachineName(spaceId, machineName);
    if (!row) throw ManabloxError.notFound('environment.notFound', { spaceId, machineName });
    return row;
  }

  /** One lifecycle change per space at a time. */
  private locked<T>(spaceId: string, fn: () => Promise<T>): Promise<T> {
    return this.repos.locks.withLock(`environments:${spaceId}`, fn);
  }
}
