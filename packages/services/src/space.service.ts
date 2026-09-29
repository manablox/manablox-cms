import {
  type AnyLimitKey,
  diffRecords,
  isSpaceReady,
  type Loose,
  ManabloxError,
  purgeTags,
  type ResolvedScope,
  type SpaceAssetSettings,
  type SpaceRole,
  snapshotChanges,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import {
  type MembershipRow,
  type Repositories,
  type SpaceRow,
  type SpaceWriteData,
  type TransactionRepositories,
  type UserRow,
  uniqueViolation,
} from '@manablox/db';
import type { ConfigSelection, ConfigSourceResult, SpaceConfigService } from './config/service.js';
import { hostSources } from './data/registry.js';
import type { RoleService } from './role.service.js';
import { setAssetSettings } from './space/assets.js';
import { SpaceContext } from './space/context.js';
import { attachNominationCleanup, setHome } from './space/home.js';
import {
  addMembers,
  auditMember,
  beforeGrant,
  candidates,
  grant,
  listMembers,
  revoke,
  type SpaceCandidate,
  seatsChanged,
} from './space/members.js';
import { exportSpace, importRestored, importSpace, resumeImport } from './space/transfer.js';
import {
  applySpacePluginSteps,
  finishSpacePluginSteps,
  type SpacePluginDrafts,
  spacePluginSteps,
} from './space-plugins.js';
import type { ImportResult, TransferInventory, TransferSelection } from './transfer/format.js';
import type { SpaceTransferService } from './transfer/service.js';
import type { ImportFileSource } from './transfer/staging.js';

/**
 * How long a space found ready is trusted without a lookup (not at all with the cache off); a
 * space never becomes unready.
 */
const READY_TTL_MS = 30_000;

export type { SpaceRole };

/** A new space; `plugins` holds the plugins' create step drafts by plugin id. */
export interface SpaceCreateData extends SpaceWriteData {
  plugins?: SpacePluginDrafts | undefined;
}

/** A created space with what the plugins' after-commit steps reported. */
export type CreatedSpace = SpaceRow & { warnings: string[] };

export type { SpaceCandidate } from './space/members.js';

/** Maps the `spaces_machine_name_key` violation to a field error instead of a 500. */
const machineNameConflict = uniqueViolation({
  constraint: 'machine_name',
  key: 'space.machineName.taken',
  path: ['machineName'],
  errorKey: 'space.validation.failed',
});

/** The default locale must be one of the space's locales; it is the fallback. */
function assertDefaultIsALocale(defaultLocale: string, locales: readonly string[]): void {
  if (locales.includes(defaultLocale)) return;
  throw ManabloxError.validation(
    [
      {
        key: 'space.defaultLocale.notInLocales',
        path: ['defaultLocale'],
        params: { defaultLocale, locales: locales.join(', ') },
      },
    ],
    'space.validation.failed',
  );
}

/** Same locales, order ignored. */
function sameLocales(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((locale) => b.includes(locale));
}

/** Space and membership rules, shared by every transport. */
export class SpaceService {
  private readonly ctx: SpaceContext;
  /** Space id -> until when it counts as ready without a lookup. */
  private readonly ready = new Map<string, number>();

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    /** Whether a role exists in a space. */
    private readonly roles: RoleService,
    /** Exports, imports and their files. */
    private readonly transfer: SpaceTransferService,
    /** The space's model as config code. */
    private readonly config: SpaceConfigService,
  ) {
    this.ctx = new SpaceContext(manablox, repos, roles, transfer, config);
  }

  /** This service on other repositories, e.g. a transaction's; hooks then run after commit. */
  using(repos: Repositories): SpaceService {
    return new SpaceService(
      this.manablox,
      repos,
      this.roles.using(repos),
      this.transfer,
      this.config,
    );
  }

  /**
   * Creates a space owned by `ownerId`; `fill`, then the plugins' create steps run in the same
   * transaction, so a failure leaves no space behind. Once committed, `committed` runs, then
   * the plugins' `afterCommit` steps, whose failures come back as warnings.
   */
  async create(
    { plugins: drafts, ...input }: SpaceCreateData,
    ownerId: string | null,
    fill?: (space: SpaceRow, repos: TransactionRepositories) => Promise<unknown>,
    committed?: (space: SpaceRow) => Promise<unknown>,
  ): Promise<CreatedSpace> {
    assertDefaultIsALocale(
      input.defaultLocale ?? 'en',
      input.locales ?? [input.defaultLocale ?? 'en'],
    );
    const steps = await spacePluginSteps(this.manablox, drafts);
    await this.manablox.hooks.run('space:beforeCreate', input, {
      manablox: this.manablox,
      spaceId: null,
    });
    await this.manablox.controls.assertLimit(null, 'spaces');
    await this.manablox.controls.assertLimit(null, 'localesPerSpace', {
      increment: (input.locales ?? [input.defaultLocale ?? 'en']).length,
    });
    const space = await this.repos.transaction(async (tx) => {
      const space = await tx.spaces
        .create(input)
        .catch(machineNameConflict({ machineName: input.machineName }));
      if (ownerId) {
        await beforeGrant(this.ctx, space.id, ownerId, 'owner', null);
        await tx.users.grant(ownerId, space.id, 'owner');
      }
      await this.ctx.audit.in(tx).record('space.create', space, snapshotChanges(space, 'created'));
      await this.ctx.spaceEvent('space.created', space, tx);
      if (ownerId) {
        await auditMember(this.ctx, 'member.grant', space, ownerId, null, 'owner', tx);
        await seatsChanged(this.ctx, space.id, [ownerId], 'added', tx);
      }
      await fill?.(space, tx);
      await applySpacePluginSteps(this.manablox, steps, space, ownerId, tx);
      return space;
    });
    await committed?.(space);
    const warnings = await finishSpacePluginSteps(this.manablox, steps, space, ownerId);
    return { ...space, warnings };
  }

  async update(spaceId: string, data: Loose<SpaceWriteData>): Promise<SpaceRow> {
    const current = await this.ctx.require(spaceId);
    // A partial update checks against the stored value of the half it omits.
    if (data.defaultLocale || data.locales) {
      assertDefaultIsALocale(
        data.defaultLocale ?? current.defaultLocale,
        data.locales ?? current.locales,
      );
    }
    if (data.locales && !sameLocales(data.locales, current.locales)) {
      await this.manablox.hooks.run(
        'space:beforeLocalesChange',
        { spaceId, locales: data.locales, previous: current.locales },
        { manablox: this.manablox, spaceId },
      );
      await this.manablox.controls.assertLimit(spaceId, 'localesPerSpace', {
        increment: data.locales.length - current.locales.length,
      });
    }
    return this.repos.transaction(async (tx) => {
      const space = await tx.spaces
        .update(spaceId, data)
        .catch(machineNameConflict({ machineName: data.machineName ?? '' }));
      await this.ctx.audit.in(tx).record('space.update', space, diffRecords(current, space));
      // Cached locale-less responses may now be in the wrong locale.
      if (space.defaultLocale !== current.defaultLocale) {
        tx.afterCommit(() => purgeTags(this.manablox, space.id, [`space:${space.id}`]));
      }
      return space;
    });
  }

  /** Also removes the staging area of an unfinished import. */
  async delete(spaceId: string): Promise<void> {
    const space = await this.ctx.require(spaceId);
    await this.repos.transaction(async (tx) => {
      await tx.spaces.delete(spaceId);
      // Control rows have no foreign key to the space.
      await tx.controlSettings.deleteScope({ kind: 'space', id: spaceId });
      await tx.usageCounters.deleteScope({ kind: 'space', id: spaceId });
      await this.ctx.audit.in(tx).record('space.delete', space, snapshotChanges(space, 'deleted'));
      await this.ctx.spaceEvent('space.deleted', space, tx);
      tx.afterCommit(() =>
        purgeTags(this.manablox, spaceId, [
          `space:${spaceId}`,
          ...hostSources(this.manablox).map((source) => source.cacheTag),
        ]),
      );
    });
    this.ready.delete(spaceId);
    await this.transfer.discard(space).catch((error: unknown) => {
      this.manablox.logger.warn({ err: error, spaceId }, 'import staging not removed');
    });
  }

  /** Whether the space exists and its import, if any, finished. */
  async isReady(spaceId: string): Promise<boolean> {
    const until = this.ready.get(spaceId);
    if (until && until > Date.now()) return true;
    const space = await this.repos.spaces.findById(spaceId);
    if (!space || !isSpaceReady(space)) return false;
    if (this.manablox.config.cache.enabled) this.ready.set(spaceId, Date.now() + READY_TTL_MS);
    return true;
  }

  /** Refuses writes to a space whose import has not finished. */
  async assertWritable(spaceId: string): Promise<void> {
    if (await this.isReady(spaceId)) return;
    const space = await this.repos.spaces.findById(spaceId);
    if (space && !isSpaceReady(space)) {
      throw ManabloxError.conflict('space.importing', { spaceId, status: space.importStatus });
    }
  }

  /**
   * Nominates the environment's home document, stored in `settings` (a staging
   * environment's under `settings.environments`); `null` clears it.
   */
  setHome(scope: string | ResolvedScope, contentId: string | null): Promise<SpaceRow> {
    return setHome(this.ctx, scope, contentId);
  }

  /**
   * Clears nominations of deleted documents, every environment's, in the delete's transaction;
   * settings have no foreign keys.
   */
  attach(): void {
    attachNominationCleanup(this.ctx);
  }

  /**
   * Upload limits may only narrow the env ceiling and the control-owned bounds; wider ones are
   * refused, naming the bound. `{}` resets.
   */
  setAssetSettings(spaceId: string, input: SpaceAssetSettings): Promise<SpaceRow> {
    return setAssetSettings(this.ctx, spaceId, input);
  }

  /** The locales the editor's language switcher offers. */
  async locales(spaceId: string): Promise<{ available: string[]; default: string }> {
    const space = await this.ctx.require(spaceId);
    return { available: space.locales, default: space.defaultLocale };
  }

  // -------------------------------------------------------------------------
  // Members
  // -------------------------------------------------------------------------

  /** The space's members with their accounts. */
  members(spaceId: string): Promise<Array<MembershipRow & { user: UserRow }>> {
    return listMembers(this.ctx, spaceId);
  }

  /** Grants a role; demoting the last owner is refused. */
  grant(spaceId: string, userId: string, role: SpaceRole): Promise<void> {
    return grant(this.ctx, spaceId, userId, role);
  }

  revoke(spaceId: string, userId: string): Promise<void> {
    return revoke(this.ctx, spaceId, userId);
  }

  /**
   * Adds several members, all or none; existing ones are skipped. `mail: false` tells them in
   * the admin only.
   */
  addMembers(
    spaceId: string,
    userIds: string[],
    role: SpaceRole,
    options: { mail?: boolean } = {},
  ): Promise<number> {
    return addMembers(this.ctx, spaceId, userIds, role, options);
  }

  /** Non-members for the add-member picker; name, email and id only. */
  candidates(spaceId: string, search?: string): Promise<SpaceCandidate[]> {
    return candidates(this.ctx, spaceId, search);
  }

  // -------------------------------------------------------------------------
  // Transfer
  // -------------------------------------------------------------------------

  /** What the space offers a transfer. */
  async inventory(spaceId: string): Promise<TransferInventory> {
    return this.transfer.inventory(spaceId);
  }

  /** What can be exported as config source, per kind. */
  async configInventory(spaceId: string) {
    return this.config.inventory(spaceId);
  }

  /** The space's admin-built model as `manablox.config.ts` source. */
  async configSource(spaceId: string, selection?: ConfigSelection): Promise<ConfigSourceResult> {
    return this.config.source(spaceId, selection ?? {});
  }

  /** Audited, since an export holds every document. A staging scope exports that environment. */
  export(scope: string | ResolvedScope, selection?: TransferSelection) {
    return exportSpace(this.ctx, scope, selection);
  }

  /**
   * Restores an export with its ids; the importer becomes owner when the space is created.
   * `files` stages the archive's asset files first.
   */
  import(
    payload: unknown,
    ownerId: string,
    selection?: TransferSelection,
    files?: ImportFileSource,
  ) {
    return importSpace(this.ctx, payload, ownerId, selection, files);
  }

  /** Continues an interrupted import from its staged file; checked like `import`. */
  resumeImport(spaceId: string) {
    return resumeImport(this.ctx, spaceId);
  }

  /**
   * Imports an export as a new space with these members, as a snapshot restore does; the
   * caller checks the features. `limitOffset` is what a replaced space already counts.
   */
  importRestored(
    payload: unknown,
    members: ReadonlyArray<{ userId: string; role: SpaceRole }>,
    options: { actorId?: string | null; limitOffset?: Partial<Record<AnyLimitKey, number>> } = {},
  ): Promise<ImportResult> {
    return importRestored(this.ctx, payload, members, options);
  }

  /** The space, or `null`. */
  get(spaceId: string): Promise<SpaceRow | null> {
    return this.repos.spaces.findById(spaceId);
  }

  /** Spaces by name; `null` ids lists every space. */
  list(spaceIds: string[] | null = null): Promise<SpaceRow[]> {
    return spaceIds ? this.repos.spaces.listByIds(spaceIds) : this.repos.spaces.list();
  }
}
