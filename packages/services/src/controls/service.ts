import { isDeepStrictEqual } from 'node:util';
import {
  type AuditChange,
  auditor,
  type ControlScope,
  diffRecords,
  type ErrorDetail,
  ManabloxError,
  purgeTags,
  scopeLabel,
  snapshotChanges,
  validateControl,
} from '@manablox/core';
import { CONTROL_ACTOR, type Manablox } from '@manablox/core/node';
import {
  type ControlSettingRow,
  type Repositories,
  type SpaceGroupRow,
  type SpaceGroupWriteData,
  type SpaceRow,
  type TransactionRepositories,
  uniqueViolation,
} from '@manablox/db';
import { hostSources, providerCacheTags } from '../data/registry.js';
import { type ControlStore, controlScopeTag } from './store.js';

/** A space group by its id or by the external layer's id. */
export type SpaceGroupRef = { id: string } | { externalId: string };

/** Stored control values of one scope, by key. */
export type ControlSettings = Record<string, unknown>;

const externalIdTaken = uniqueViolation({
  constraint: 'external_id',
  key: 'spaceGroup.externalId.taken',
  path: ['externalId'],
  errorKey: 'validation.failed',
});

type ScopeTarget = { id: string; spaceId: null };

/** A plugin's control key; its providers' cached output may show it. */
const PLUGIN_KEY = /^(?:[a-zA-Z]+\.)?plugins\./;

/**
 * Writes control values and space groups for the control API. Values are validated against
 * the catalogue; every write is audited as the control API and purges the cached controls.
 */
export class ControlService {
  private readonly audit;
  private readonly groupAudit;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    /** Purged after each write; `null` when nothing caches controls. */
    private readonly store:
      | (Pick<ControlStore, 'invalidate'> & Partial<Pick<ControlStore, 'assertLimitAt'>>)
      | null = null,
  ) {
    this.audit = auditor(repos, 'control', (target: ScopeTarget) => target.id, {
      actor: CONTROL_ACTOR,
    });
    this.groupAudit = auditor(repos, 'spaceGroup', (group: SpaceGroupRow) => group.name, {
      spaceId: () => null,
      actor: CONTROL_ACTOR,
    });
  }

  /** The values a scope stores. */
  async settings(scope: ControlScope): Promise<ControlSettings> {
    await this.assertScope(scope);
    return valuesOf(await this.repos.controlSettings.listByScope(scope));
  }

  /** Every stored value, per scope label. */
  async allSettings(): Promise<Record<string, ControlSettings>> {
    const out: Record<string, ControlSettings> = {};
    for (const row of await this.repos.controlSettings.listAll()) {
      const label = row.scopeKind === 'instance' ? 'instance' : `${row.scopeKind}:${row.scopeId}`;
      out[label] = { ...out[label], [row.key]: row.value };
    }
    return out;
  }

  /** Sets one key; returns the stored value. */
  async set(scope: ControlScope, key: string, value: unknown): Promise<unknown> {
    const values = await this.patch(scope, { [key]: value });
    return values[key];
  }

  /** Sets the given keys and keeps the others; returns the scope's values. */
  async patch(scope: ControlScope, input: ControlSettings): Promise<ControlSettings> {
    const values = this.validate(scope, input);
    await this.assertScope(scope);
    return this.write(scope, 'control.set', async (repos, before) => {
      const after = { ...before, ...values };
      if (Object.keys(values).length > 0) await repos.controlSettings.upsertMany(scope, values);
      return after;
    });
  }

  /** Makes `input` the scope's whole set in one transaction; unlisted keys are removed. */
  async replaceScope(scope: ControlScope, input: ControlSettings): Promise<ControlSettings> {
    const values = this.validate(scope, input);
    await this.assertScope(scope);
    return this.write(scope, 'control.replace', async (repos) => {
      await repos.controlSettings.replaceScope(scope, values);
      return values;
    });
  }

  /** Removes one key, restoring its default at this scope; false when it was not set. */
  async delete(scope: ControlScope, key: string): Promise<boolean> {
    await this.assertScope(scope);
    let removed = false;
    await this.write(scope, 'control.delete', async (repos, before) => {
      removed = await repos.controlSettings.delete(scope, key);
      const { [key]: _removed, ...after } = before;
      return after;
    });
    return removed;
  }

  listGroups(): Promise<SpaceGroupRow[]> {
    return this.repos.spaceGroups.list();
  }

  async group(ref: SpaceGroupRef): Promise<SpaceGroupRow> {
    const group =
      'id' in ref
        ? await this.repos.spaceGroups.findById(ref.id)
        : await this.repos.spaceGroups.findByExternalId(ref.externalId);
    if (!group) throw ManabloxError.notFound('spaceGroup.notFound', { ...ref });
    return group;
  }

  /** The spaces in a group, by name. */
  async groupSpaces(ref: SpaceGroupRef): Promise<SpaceRow[]> {
    return this.repos.spaceGroups.listSpaces((await this.group(ref)).id);
  }

  async createGroup(data: SpaceGroupWriteData): Promise<SpaceGroupRow> {
    return this.repos.transaction(async (tx) => {
      const group = await tx.spaceGroups
        .create(data)
        .catch(externalIdTaken({ externalId: data.externalId }));
      await this.groupAudit
        .in(tx)
        .record('spaceGroup.create', group, snapshotChanges(group, 'created'));
      return group;
    });
  }

  /** Name and external id only; they do not change what the group's spaces resolve to. */
  async updateGroup(
    ref: SpaceGroupRef,
    data: Partial<SpaceGroupWriteData>,
  ): Promise<SpaceGroupRow> {
    const current = await this.group(ref);
    return this.repos.transaction(async (tx) => {
      const group = await tx.spaceGroups
        .update(current.id, data)
        .catch(externalIdTaken({ externalId: data.externalId }));
      if (!group) throw ManabloxError.notFound('spaceGroup.notFound', { id: current.id });
      await this.groupAudit.in(tx).record('spaceGroup.update', group, diffRecords(current, group));
      return group;
    });
  }

  /** Deletes the group and its values; its spaces stay, without a group. */
  async deleteGroup(ref: SpaceGroupRef): Promise<void> {
    const group = await this.group(ref);
    const scope: ControlScope = { kind: 'group', id: group.id };
    const spaceIds = await this.repos.transaction(async (tx) => {
      const members = await tx.spaceGroups.listSpaceIds(group.id);
      for (const spaceId of members) {
        await this.manablox.controls.emit(
          'space.groupChanged',
          { kind: 'space', id: spaceId },
          { spaceId, from: groupRef(group), to: null },
          { tx },
        );
      }
      await tx.controlSettings.deleteScope(scope);
      await tx.usageCounters.deleteScope(scope);
      await tx.spaceGroups.delete(group.id);
      await this.groupAudit
        .in(tx)
        .record('spaceGroup.delete', group, snapshotChanges(group, 'deleted'), {
          spaceIds: members,
        });
      return members;
    });
    await this.invalidate([
      controlScopeTag(scope),
      ...spaceIds.map((id) => controlScopeTag({ kind: 'space', id })),
    ]);
    await this.purgeProviderCaches(spaceIds);
  }

  /** Throws `control.limit` when `count` more spaces pass the group's hard `spaces` limit. */
  async assertGroupRoom(ref: SpaceGroupRef, count = 1): Promise<void> {
    const group = await this.group(ref);
    await this.store?.assertLimitAt?.({ kind: 'group', id: group.id }, 'spaces', count);
  }

  /**
   * Moves spaces into the group, out of any other; `replace` takes the group's other spaces
   * out of it. The group's `spaces` limit counts the spaces joining less those leaving, unless
   * `checked`; a hard one refuses and nothing moves. Returns the ids of the spaces whose group changed.
   */
  async assignSpaces(
    ref: SpaceGroupRef,
    spaceIds: readonly string[],
    options: { replace?: boolean; checked?: boolean } = {},
  ): Promise<string[]> {
    const group = await this.group(ref);
    const ids = [...new Set(spaceIds)];
    const found = new Set((await this.repos.spaces.listByIds(ids)).map((space) => space.id));
    const missing = ids.find((id) => !found.has(id));
    if (missing) throw ManabloxError.notFound('space.notFound', { spaceId: missing });

    const scope: ControlScope = { kind: 'group', id: group.id };
    const current = await this.repos.spaceGroups.listSpaceIds(group.id);
    const joining = ids.filter((id) => !current.includes(id)).length;
    const leaving = options.replace ? current.filter((id) => !ids.includes(id)).length : 0;
    if (!options.checked) await this.store?.assertLimitAt?.(scope, 'spaces', joining - leaving);

    const changed = await this.repos.transaction(async (tx) => {
      const before = await tx.spaceGroups.listSpaceIds(group.id);
      const previous = new Map(
        (await tx.spaces.listByIds([...new Set([...ids, ...before])])).map((space) => [
          space.id,
          space.groupId,
        ]),
      );
      const moved = await tx.spaceGroups.assignSpaces(group.id, ids, options);
      if (moved.length > 0) {
        const groups = new Map((await tx.spaceGroups.list()).map((row) => [row.id, row]));
        for (const spaceId of moved) {
          const from = groups.get(previous.get(spaceId) ?? '');
          await this.manablox.controls.emit(
            'space.groupChanged',
            { kind: 'space', id: spaceId },
            {
              spaceId,
              from: from ? groupRef(from) : null,
              to: ids.includes(spaceId) ? groupRef(group) : null,
            },
            { tx },
          );
        }
        const after = await tx.spaceGroups.listSpaceIds(group.id);
        await this.groupAudit
          .in(tx)
          .record('spaceGroup.assignSpaces', group, [
            { path: 'spaces', from: before.sort(), to: after.sort() },
          ]);
      }
      return moved;
    });
    await this.invalidate(changed.map((id) => controlScopeTag({ kind: 'space', id })));
    await this.purgeProviderCaches(changed);
    return changed;
  }

  /** Runs `apply` in a transaction with the scope's values before it; audits the difference. */
  private async write(
    scope: ControlScope,
    action: 'control.set' | 'control.replace' | 'control.delete',
    apply: (repos: TransactionRepositories, before: ControlSettings) => Promise<ControlSettings>,
  ): Promise<ControlSettings> {
    const { after, changes, suspension } = await this.repos.transaction(async (tx) => {
      const before = valuesOf(await tx.controlSettings.listByScope(scope));
      const next = await apply(tx, before);
      const diff: AuditChange[] = diffRecords(before, next);
      if (diff.length > 0) {
        await this.audit.in(tx).record(action, { id: scopeLabel(scope), spaceId: null }, diff);
      }
      const stateChanged =
        scope.kind === 'instance' && !isDeepStrictEqual(before.state, next.state);
      if (stateChanged) {
        await this.manablox.controls.emit(
          'instance.stateChanged',
          scope,
          { from: before.state ?? null, to: next.state ?? null },
          { tx },
        );
      }
      return {
        after: valuesOf(await tx.controlSettings.listByScope(scope)),
        changes: diff,
        suspension: stateChanged && isSuspended(before.state) !== isSuspended(next.state),
      };
    });
    if (changes.length > 0) await this.invalidate([controlScopeTag(scope)]);
    if (suspension) await this.purgeDeliveries();
    if (changes.some((change) => change.path === 'domains.requireVerification')) {
      // Unverified hosts start or stop being served.
      const tags = hostSources(this.manablox).map((source) => source.cacheTag);
      await purgeTags(this.manablox, null, tags).catch((error: unknown) =>
        this.manablox.logger.warn({ err: error }, 'host lookups not purged'),
      );
    }
    if (changes.some((change) => PLUGIN_KEY.test(change.path))) {
      await this.purgeProviderCaches(
        scope.kind === 'instance'
          ? 'all'
          : scope.kind === 'space'
            ? [scope.id]
            : await this.repos.spaceGroups.listSpaceIds(scope.id),
      );
    }
    return after;
  }

  /** Parsed values; every issue of every key in one validation error. */
  private validate(scope: ControlScope, input: ControlSettings): ControlSettings {
    const issues: ErrorDetail[] = [];
    const values: ControlSettings = {};
    for (const [key, value] of Object.entries(input)) {
      const result = validateControl(key, value, scope.kind);
      if (result.ok) values[key] = result.value;
      else
        issues.push(
          ...result.issues.map((issue) => ({ ...issue, path: [key, ...(issue.path ?? [])] })),
        );
    }
    if (issues.length > 0) throw ManabloxError.validation(issues);
    return values;
  }

  private async assertScope(scope: ControlScope): Promise<void> {
    if (scope.kind === 'space' && !(await this.repos.spaces.findById(scope.id))) {
      throw ManabloxError.notFound('space.notFound', { spaceId: scope.id });
    }
    if (scope.kind === 'group' && !(await this.repos.spaceGroups.findById(scope.id))) {
      throw ManabloxError.notFound('spaceGroup.notFound', { id: scope.id });
    }
  }

  /** Drops the data providers' caches of the spaces, in every process; a failure is only logged. */
  private async purgeProviderCaches(spaceIds: readonly string[] | 'all'): Promise<void> {
    try {
      const ids =
        spaceIds === 'all' ? (await this.repos.spaces.list()).map((space) => space.id) : spaceIds;
      const tags = ids.flatMap((id) => providerCacheTags(this.manablox, id));
      if (tags.length) await purgeTags(this.manablox, null, tags);
    } catch (error) {
      this.manablox.logger.warn({ err: error }, 'provider caches not purged');
    }
  }

  /** Drops every space's cached deliveries and provider caches, CDNs included. */
  private async purgeDeliveries(): Promise<void> {
    try {
      const spaces = await this.repos.spaces.list();
      await purgeTags(
        this.manablox,
        null,
        spaces.flatMap((space) => [
          `space:${space.id}`,
          ...providerCacheTags(this.manablox, space.id),
        ]),
      );
    } catch (error) {
      this.manablox.logger.warn({ err: error }, 'deliveries not purged');
    }
  }

  private async invalidate(tags: string[]): Promise<void> {
    if (tags.length === 0 || !this.store) return;
    await this.store.invalidate(tags);
    this.manablox.logger.debug({ tags }, 'controls purged');
  }
}

/** How events name a group. */
function groupRef(group: SpaceGroupRow): { id: string; externalId: string | null } {
  return { id: group.id, externalId: group.externalId };
}

function isSuspended(state: unknown): boolean {
  return (state as { status?: unknown } | undefined)?.status === 'suspended';
}

function valuesOf(rows: readonly ControlSettingRow[]): ControlSettings {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
