import { randomUUID } from 'node:crypto';
import {
  type AnyLimitKey,
  type ErrorDetail,
  envUploadRules,
  ManabloxError,
  narrowUploadRules,
  purgeTags,
  type ResolvedScope,
  type Scope,
  type SpaceImportProgress,
  scopeSpaceId,
  stagingIdOf,
  uploadTypeAllowed,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories, SpaceRow, TransactionRepositories } from '@manablox/db';
import { notifyLiveChange, snapshotProviders, transferProviders } from '../data/registry.js';
import { SpaceNominations } from '../nominations.js';
import {
  allAssets,
  allContent,
  allMenus,
  allRedirects,
  attachAssetTags,
  attachContentTags,
  attachHistory,
} from './export.js';
import {
  assertExport,
  byLabel,
  type ExportedAsset,
  type ImportResult,
  keepChosen,
  runtimeOnly,
  type SelectableSection,
  SPACE_EXPORT_SECTIONS,
  SPACE_EXPORT_VERSION,
  type SpaceExport,
  selectContents,
  type TransferInventory,
  type TransferSelection,
  toExportedAsset,
  toExportedContent,
  toExportedCredential,
  toExportedRedirect,
  toExportedRole,
  toExportedSpace,
} from './format.js';
import { runImportHooks } from './import/hooks.js';
import { type ImportPlan, type ImportStep, planSpaceImport } from './import/plan.js';
import { type ImportFileSource, ImportStaging, type ImportStorage } from './staging.js';

/** Progress marker of the step after the last planned one. */
const FINISH_STEP = 'finish';

/** An import this long without progress counts as interrupted and may be resumed. */
export const STALE_IMPORT_MS = 10 * 60 * 1000;

export interface ImportOptions {
  /** The archive's asset files, staged before any database write. */
  files?: ImportFileSource | undefined;
  /** Runs in the transaction that creates the space. */
  created?: ((repos: TransactionRepositories, spaceId: string) => Promise<void>) | undefined;
  /** Runs in the transaction that marks the space ready. */
  finished?: ((repos: TransactionRepositories, result: ImportResult) => Promise<void>) | undefined;
  /** Subtracted from what the import counts against each limit, e.g. a space it replaces. */
  limitOffset?: Partial<Record<AnyLimitKey, number>> | undefined;
}

/**
 * Moves a space between instances. Ids are preserved because field values reference
 * them, so importing into an instance that already has the space is refused.
 *
 * Not transferred: users, memberships (the importer becomes owner), API keys, audit log,
 * notifications, approvals, image variants, asset usages and vault secrets; plugins leave out
 * their own logs, such as workflow runs and webhook deliveries.
 */
export class SpaceTransferService {
  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    /** Stages archive files and the export for a resume; without it an import cannot resume. */
    private readonly storage: ImportStorage | null = null,
  ) {}

  /** Spaces importing in this process. */
  private readonly running = new Set<string>();

  /** What the space holds, per section. */
  async inventory(spaceId: string): Promise<TransferInventory> {
    const space = await this.repos.spaces.findById(spaceId);
    if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });

    const [types, summary, assets, menus, roles, credentials, redirects, plugins] =
      await Promise.all([
        this.repos.contentTypes.list(),
        this.repos.content.countSummary(spaceId),
        this.repos.assets.page({ spaceId }, { limit: 1, offset: 0 }),
        this.repos.menus.listBySpace(spaceId),
        this.repos.roles.listBySpace(spaceId),
        this.repos.credentials.listBySpace(spaceId).then(runtimeOnly),
        this.repos.redirects.page(spaceId, {}, { limit: 1, offset: 0 }),
        Promise.all(
          transferProviders(this.manablox).map(async ({ kind, transfer }) => {
            const context = { manablox: this.manablox, repos: this.repos, spaceId };
            const [count, entries] = await Promise.all([
              transfer.count(context),
              transfer.entries?.(context),
            ]);
            return { kind, count, entries };
          }),
        ),
      ]);

    // The same rows counted three ways.
    const group = (key: 'typeId' | 'locale' | 'status', label: (id: string) => string) => {
      const counts = new Map<string, number>();
      for (const row of summary) {
        const id = row[key];
        counts.set(id, (counts.get(id) ?? 0) + row.count);
      }
      return [...counts].map(([id, count]) => ({ id, label: label(id), count }));
    };
    const typeLabel = (id: string) => this.manablox.contentTypes.tryGet(id)?.label ?? id;

    return {
      contentTypes: types
        .filter((type) => type.spaceId === spaceId)
        .map((type) => ({ id: type.id as string, label: type.label })),
      contents: {
        total: summary.reduce((sum, row) => sum + row.count, 0),
        types: group('typeId', typeLabel).sort(byLabel),
        locales: group('locale', (id) => id).sort(byLabel),
        statuses: group('status', (id) => id).sort(byLabel),
      },
      assets: assets.total,
      menus: menus.map((menu) => ({ id: menu.id, label: menu.name })),
      roles: roles.map((role) => ({ id: role.id, label: role.name })),
      credentials: credentials.map((credential) => ({ id: credential.id, label: credential.name })),
      redirects: redirects.total,
      plugins: Object.fromEntries(plugins.map(({ kind, count }) => [kind, count])),
      pluginEntries: Object.fromEntries(
        plugins.flatMap(({ kind, entries }) => (entries ? [[kind, entries]] : [])),
      ),
    };
  }

  /** The space's production environment, or the staging environment `scope` names. */
  async export(
    scope: string | ResolvedScope,
    selection: TransferSelection = {},
  ): Promise<SpaceExport> {
    const spaceId = scopeSpaceId(scope);
    const staging = stagingIdOf(scope);
    const within: Scope = staging ? { spaceId, environmentId: staging } : spaceId;
    const space = await this.repos.spaces.findById(spaceId);
    if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });

    const providers = transferProviders(this.manablox);
    const wanted = new Set<string>(
      selection.sections ?? [...SPACE_EXPORT_SECTIONS, ...providers.map(({ kind }) => kind)],
    );
    // History needs the documents.
    if (!wanted.has('contents')) wanted.delete('history');
    const chosen = (section: SelectableSection) => selection.ids?.[section];
    const exported = providers.filter(({ kind }) => wanted.has(kind));

    const payload: SpaceExport = {
      manabloxSpaceExport: SPACE_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      sections: [
        ...SPACE_EXPORT_SECTIONS.filter((section) => wanted.has(section)),
        ...exported.map(({ kind }) => kind),
      ],
      space: toExportedSpace(space),
    };
    // A staging export carries its own nominations as the space's.
    const nominations = await SpaceNominations.load(this.manablox, this.repos, spaceId);
    if (staging && nominations) payload.space.settings = nominations.settingsAsProduction(staging);
    const pluginSettings = await this.pluginSettingsOf(spaceId, staging, nominations);
    if (Object.keys(pluginSettings).length) payload.pluginSettings = pluginSettings;

    if (wanted.has('contentTypes')) {
      const types = staging
        ? await this.repos.contentTypes.listByScope(within)
        : await this.repos.contentTypes.list();
      payload.contentTypes = keepChosen(
        types.filter((type) => type.spaceId === spaceId),
        chosen('contentTypes'),
        (type) => type.id as string,
      );
    }
    if (wanted.has('contents')) {
      // Config-managed documents do not travel.
      const rows = runtimeOnly(await allContent(this.repos, within));
      payload.contents = selectContents(rows.map(toExportedContent), selection.contents);
      if (wanted.has('history')) await attachHistory(this.repos, payload.contents);
      await attachContentTags(this.repos, payload.contents);
    }
    if (wanted.has('assets')) {
      payload.assets = (await allAssets(this.repos, spaceId)).map(toExportedAsset);
      await attachAssetTags(this.repos, spaceId, payload.assets);
    }
    if (wanted.has('menus')) {
      payload.menus = await allMenus(this.repos, within, chosen('menus'));
    }
    if (wanted.has('roles')) {
      const rows = await this.repos.roles.listBySpace(spaceId);
      payload.roles = keepChosen(rows, chosen('roles')).map(toExportedRole);
    }
    if (wanted.has('credentials')) {
      const rows = runtimeOnly(await this.repos.credentials.listBySpace(spaceId));
      payload.credentials = keepChosen(rows, chosen('credentials')).map(toExportedCredential);
    }
    if (wanted.has('redirects')) {
      payload.redirects = (await allRedirects(this.repos, within)).map(toExportedRedirect);
    }
    if (exported.length) {
      payload.plugins = {};
      for (const { kind, transfer } of exported) {
        const picked = transfer.entries ? selection.ids?.[kind] : undefined;
        const context = { manablox: this.manablox, repos: this.repos, spaceId, scope: within };
        payload.plugins[kind] = await transfer.export(picked ? { ...context, picked } : context);
      }
    }

    return payload;
  }

  /** What the space counts against each limit, as restoring a snapshot of it would. */
  async limitsOf(spaceId: string): Promise<Partial<Record<AnyLimitKey, number>>> {
    const payload = await this.export(spaceId);
    const state = await this.snapshotState(spaceId);
    if (state) payload.snapshots = state;
    return planSpaceImport(this.manablox, payload, {}).limits;
  }

  /** The data providers' snapshot state by kind; `null` when none keeps any. */
  async snapshotState(spaceId: string): Promise<Record<string, unknown> | null> {
    const providers = snapshotProviders(this.manablox);
    if (providers.length === 0) return null;
    const out: Record<string, unknown> = {};
    for (const { kind, snapshot } of providers) {
      out[kind] = await snapshot.capture({ manablox: this.manablox, repos: this.repos, spaceId });
    }
    return out;
  }

  /**
   * Restores an export as a new space: files are staged first, then the records are written
   * in steps, each its own transaction recording its progress on the space. The space stays
   * hidden until the last step; a failure leaves it `failed` for `resume` or delete.
   */
  async import(
    payload: unknown,
    actorId: string | null = null,
    selection: TransferSelection = {},
    options: ImportOptions = {},
  ): Promise<ImportResult> {
    const data = assertExport(payload);
    const plan = planSpaceImport(this.manablox, data, selection);
    await this.assertNew(data.space);
    await this.manablox.hooks.run('space:beforeCreate', data.space, {
      manablox: this.manablox,
      spaceId: null,
    });
    // A new space is in no group, so only the instance's controls apply.
    await this.assertControls(plan, null, options.limitOffset);
    if (options.files) await this.assertUploadRules(plan.assets);
    await runImportHooks(this.manablox, data.space.id, plan.hookRows);
    for (const { transfer, entries } of plan.plugins) {
      const context = { manablox: this.manablox, repos: this.repos, spaceId: data.space.id };
      await transfer.check?.(context, entries);
    }
    for (const note of plan.notes) {
      this.manablox.logger.warn({ spaceId: data.space.id }, note);
    }

    const id = randomUUID();
    const staging = this.storage ? new ImportStaging(this.storage, id) : null;
    if (!staging && options.files) throw new Error('Staging archive files needs storage.');
    try {
      await staging?.stage(data, options.files, plan.files);
    } catch (error) {
      await staging?.remove().catch(() => {});
      throw error;
    }

    const progress: SpaceImportProgress = {
      id,
      done: 1,
      total: plan.steps.length + 2,
      step: plan.steps[0]?.key ?? FINISH_STEP,
      actorId,
      selection: selection as Record<string, unknown>,
      resumable: staging !== null,
      notes: plan.notes,
      error: null,
    };
    try {
      await this.repos.transaction(async (tx) => {
        await tx.spaces.create(data.space, { status: 'importing', progress });
        for (const [plugin, settings] of Object.entries(data.pluginSettings ?? {})) {
          await tx.pluginSettings.set(data.space.id, plugin, settings);
        }
        await options.created?.(tx, data.space.id);
      });
    } catch (error) {
      await staging?.remove().catch(() => {});
      throw error;
    }
    return this.run(plan, data.space.id, progress, staging, options.finished);
  }

  /** The features and count limits the plan needs, less what `offset` already counts. */
  private async assertControls(
    plan: ImportPlan,
    spaceId: string | null,
    offset: Partial<Record<AnyLimitKey, number>> = {},
  ): Promise<void> {
    for (const [key, count] of Object.entries(plan.limits) as Array<[AnyLimitKey, number]>) {
      const increment = count - (offset[key] ?? 0);
      if (increment > 0) await this.manablox.controls.assertLimit(spaceId, key, { increment });
    }
  }

  /** Refuses files the instance's upload rules would refuse; a new space is in no group. */
  private async assertUploadRules(assets: ExportedAsset[]): Promise<void> {
    const rules = narrowUploadRules(
      envUploadRules(this.manablox.config.storage),
      (await this.manablox.controls.resolved(null)).uploads,
    );
    const details: ErrorDetail[] = [];
    for (const [index, asset] of assets.entries()) {
      if (asset.size > rules.maxFileSize) {
        details.push({
          key: 'asset.tooLarge',
          path: ['assets', index],
          params: { filename: asset.filename, size: asset.size, max: rules.maxFileSize },
        });
      } else if (!uploadTypeAllowed(asset.mimeType, rules)) {
        details.push({
          key: 'asset.mimeType.notAllowed',
          path: ['assets', index],
          params: { filename: asset.filename, mimeType: asset.mimeType },
        });
      }
    }
    if (details.length) throw ManabloxError.validation(details, 'space.import.assetsRefused');
  }

  /** Continues a failed import, or one idle for `STALE_IMPORT_MS`, from its staged file. */
  async resume(spaceId: string, finished?: ImportOptions['finished']): Promise<ImportResult> {
    const space = await this.repos.spaces.findById(spaceId);
    if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });
    const progress = space.importProgress;
    if (!space.importStatus || !progress) {
      throw ManabloxError.conflict('space.import.notResumable', { spaceId });
    }
    if (!progress.resumable || !this.storage) {
      throw ManabloxError.badRequest('space.import.notResumable', { spaceId });
    }
    const staleBefore = new Date(Date.now() - STALE_IMPORT_MS);
    if (this.running.has(spaceId) || !(await this.repos.spaces.claimImport(spaceId, staleBefore))) {
      throw ManabloxError.conflict('space.import.running', { spaceId });
    }

    const staging = new ImportStaging(this.storage, progress.id);
    let plan: ImportPlan;
    try {
      const data = assertExport(await staging.payload());
      plan = planSpaceImport(this.manablox, data, progress.selection as TransferSelection);
      // Types written by an earlier attempt, perhaps in another process.
      await this.manablox.reload(await this.repos.contentTypes.listAll(), { synced: true });
      // What earlier attempts wrote counts already.
      await this.assertControls(plan, spaceId, await this.limitsOf(spaceId));
    } catch (error) {
      throw await this.fail(spaceId, progress, progress.step ?? FINISH_STEP, error);
    }
    return this.run(plan, spaceId, { ...progress, error: null }, staging, finished);
  }

  /** Removes the staging area of a space's unfinished import. */
  async discard(space: SpaceRow): Promise<void> {
    const progress = space.importProgress;
    if (!progress?.resumable || !this.storage) return;
    await new ImportStaging(this.storage, progress.id).remove();
  }

  private async run(
    plan: ImportPlan,
    spaceId: string,
    start: SpaceImportProgress,
    staging: ImportStaging | null,
    finished: ImportOptions['finished'],
  ): Promise<ImportResult> {
    this.running.add(spaceId);
    let progress = start;
    const notes = [...start.notes];
    try {
      for (let index = progress.done - 1; index < plan.steps.length; index++) {
        const step = plan.steps[index] as ImportStep;
        try {
          progress = await this.repos.transaction(async (tx) => {
            await step.run({
              manablox: this.manablox,
              tx,
              spaceId,
              actorId: progress.actorId,
              notes,
            });
            const next: SpaceImportProgress = {
              ...progress,
              done: index + 2,
              step: plan.steps[index + 1]?.key ?? FINISH_STEP,
              notes: [...notes],
            };
            await tx.spaces.setImport(spaceId, 'importing', next);
            return next;
          });
          await step.committed?.(this.repos);
          // Lets timers and requests in between; an in-process SQLite never yields on its own.
          await new Promise((resolve) => setImmediate(resolve));
        } catch (error) {
          notes.length = progress.notes.length;
          throw await this.fail(spaceId, progress, step.key, error);
        }
      }

      let result: ImportResult;
      try {
        // Files first: a failure here leaves the staged copies for a resume.
        const files = staging ? await staging.place() : 0;
        result = plan.result(notes, files);
        await this.repos.transaction(async (tx) => {
          await tx.spaces.setImport(spaceId, null, null);
          // What the space runs, such as workflows, becomes live now.
          await notifyLiveChange(this.manablox, tx, spaceId, 'import');
          await finished?.(tx, result);
        });
        // Lookups that kept the space as importing see it ready.
        await purgeTags(this.manablox, spaceId, [`space:${spaceId}`]);
      } catch (error) {
        throw await this.fail(spaceId, progress, FINISH_STEP, error);
      }

      if (plan.hasContentTypes) await this.manablox.reload(await this.repos.contentTypes.listAll());
      await staging?.remove().catch((error: unknown) => {
        this.manablox.logger.warn({ err: error, spaceId }, 'import staging not removed');
      });
      return result;
    } finally {
      this.running.delete(spaceId);
    }
  }

  /** Marks the import failed at `step`; returns the error to throw. */
  private async fail(
    spaceId: string,
    progress: SpaceImportProgress,
    step: string,
    error: unknown,
  ): Promise<ManabloxError> {
    const cause = ManabloxError.is(error) ? error : null;
    // The detail that carries the error key's own params.
    const detail = cause?.details.find((entry) => entry.key === cause.key);
    const message = maskPaths(error instanceof Error ? error.message : String(error));
    await this.repos.spaces
      .setImport(spaceId, 'failed', {
        ...progress,
        step,
        error: {
          key: cause?.key ?? 'internal.error',
          ...(detail?.params ? { params: maskParams(detail.params) } : {}),
          message: message.slice(0, 1000),
        },
      })
      .catch((failure: unknown) => {
        this.manablox.logger.error({ err: failure, spaceId }, 'import state not saved');
      });
    this.manablox.logger.error({ err: error, spaceId, step }, 'space import failed');
    return new ManabloxError('space.import.failed', {
      kind: cause?.kind ?? 'internal',
      details: [
        { key: 'space.import.failed', params: { spaceId, step } },
        ...(cause?.details ?? []),
      ],
      cause: error,
    });
  }

  /** The environment's plugin settings by plugin id, nominations as production's. */
  private async pluginSettingsOf(
    spaceId: string,
    stagingId: string | null,
    nominations: SpaceNominations | null,
  ): Promise<Record<string, Record<string, unknown>>> {
    const rows = await this.repos.pluginSettings.listBySpace(spaceId);
    const out: Record<string, Record<string, unknown>> = {};
    for (const plugin of new Set(rows.map((row) => row.plugin))) {
      const data = nominations?.pluginSettingsAsProduction(stagingId, plugin) ?? null;
      if (data) out[plugin] = data;
    }
    return out;
  }

  /** Both keys are unique; checked here for a clearer message. */
  private async assertNew(space: SpaceExport['space']): Promise<void> {
    const [byId, byMachineName] = await Promise.all([
      this.repos.spaces.findById(space.id),
      this.repos.spaces.findByMachineName(space.machineName),
    ]);
    if (byId || byMachineName) {
      throw ManabloxError.conflict('space.import.exists', { machineName: space.machineName });
    }
  }
}

/** An absolute POSIX or Windows path, not the path of a URL. */
const ABSOLUTE_PATH =
  /(?<![\w:/.~-])(?:[A-Za-z]:)?[\\/](?:[^\s'"`,;()\\/]+[\\/])*[^\s'"`,;()\\/]+/g;

/** Hides server paths from an error shown in the admin. */
export function maskPaths(text: string): string {
  return text.replace(ABSOLUTE_PATH, '<path>');
}

function maskParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).map(([name, value]) => [
      name,
      typeof value === 'string' ? maskPaths(value) : value,
    ]),
  );
}
