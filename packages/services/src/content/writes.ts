import {
  type AuditAction,
  diffRecords,
  inScope,
  ManabloxError,
  type Scope,
  scopeOf,
  scopeSpaceId,
  snapshotChanges,
} from '@manablox/core';
import type { ContentRow, DeleteChildren } from '@manablox/db';
import { blockInstanceChecks } from '../block-extensions.js';
import { CONTENT_DIFF, type ContentCore, freeSlug, slugConflict, toWriteInput } from './core.js';
import { propagateSharedFields } from './localization.js';
import { mergeWritableFields } from './permissions.js';
import type { Actor, ContentSaveInput } from './types.js';
import { validateContent } from './validation.js';

/** Create, save, move, translate and delete, each validated, hooked and audited. */
export class ContentWrites {
  constructor(private readonly core: ContentCore) {}

  /** `stored` holds block data of plugins that are off or not loaded, for copies and translations. */
  async create(
    input: ContentSaveInput,
    actor: Actor | null,
    action: AuditAction | undefined,
    stored?: Record<string, unknown>,
  ): Promise<ContentRow> {
    const { core } = this;
    const { manablox, repos, registry } = core;
    const target: Scope = input.environmentId
      ? { spaceId: input.spaceId, environmentId: input.environmentId }
      : input.spaceId;
    const contentType = registry.get(input.typeId);
    await core.assertTypeIn(contentType, target);
    core.assertWritable(contentType);
    await core.assertFeatures(contentType, input.spaceId);
    await core.assertPlacement(contentType, input.parentId ?? null, target);
    await core.assertCountLimit(contentType, target);
    const hookContext = core.hookContext(contentType, actor, target);
    // Defaults to the space's default locale.
    if (!input.locale) {
      const space = await repos.spaces.findById(input.spaceId);
      input = { ...input, locale: space?.defaultLocale ?? 'en' };
    }

    let prepared = await manablox.hooks.run(
      'content:beforeValidate',
      toWriteInput(input),
      hookContext,
    );
    const { fields, searchText } = await validateContent(
      registry,
      contentType,
      prepared.fields,
      input,
      actor,
      hookContext,
      await blockInstanceChecks(manablox, input.spaceId),
      stored,
    );
    prepared = await manablox.hooks.run(
      'content:beforeCreate',
      { ...prepared, fields },
      hookContext,
    );
    const scope = input.environmentId
      ? { spaceId: prepared.spaceId, environmentId: input.environmentId }
      : prepared.spaceId;
    await core.assertUnique(contentType, prepared.fields, {
      spaceId: prepared.spaceId,
      environmentId: input.environmentId,
      locale: prepared.locale,
      localizationId: prepared.localizationId ?? null,
    });

    // A slugless type has no visible slug, so pick a free one instead of erroring.
    const slug = contentType.hasSlug
      ? prepared.slug
      : await freeSlug(repos, scope, prepared.locale, prepared.parentId ?? null, prepared.slug);

    return core.transaction(async (tx) => {
      const row = await tx.repos.content
        .create({
          ...(input.id ? { id: input.id } : {}),
          spaceId: prepared.spaceId,
          environmentId: input.environmentId,
          typeId: prepared.typeId,
          locale: prepared.locale,
          ...(prepared.localizationId ? { localizationId: prepared.localizationId } : {}),
          parentId: prepared.parentId ?? null,
          title: prepared.title,
          slug,
          fields: prepared.fields,
          searchText,
          position: prepared.position ?? 0,
          hasSlug: contentType.hasSlug,
          actorId: actor?.userId ?? null,
          ...(input.source !== undefined ? { source: input.source } : {}),
          ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
        })
        .catch(slugConflict({ slug: slug ?? '' }));

      await propagateSharedFields(tx.repos, row, contentType);
      await tx.listeners('content:afterCreate', row, hookContext);
      await tx.after(() =>
        manablox.hooks.run('content:afterCreate', row, tx.committedContext(hookContext)),
      );
      await tx.audit.record(
        action ?? (input.localizationId ? 'content.translate' : 'content.create'),
        row,
        snapshotChanges(row, 'created', CONTENT_DIFF),
      );
      return row;
    });
  }

  async save(
    scope: Scope,
    id: string,
    input: ContentSaveInput,
    actor: Actor | null,
    action: 'content.update' | 'content.restore',
    meta: Record<string, unknown> | null = null,
  ): Promise<ContentRow> {
    const { core } = this;
    const { manablox, registry } = core;
    const spaceId = scopeSpaceId(scope);
    const existing = await core.find(scope, id);
    input = { ...input, spaceId };

    // Config-managed documents are writable only by the reconciler, which passes `source`.
    if (existing.source === 'code' && input.source !== 'code') {
      throw ManabloxError.forbidden('content.code.immutable', { id, title: existing.title });
    }

    const contentType = registry.get(input.typeId);
    await core.assertTypeIn(contentType, scopeOf(existing));
    core.assertWritable(contentType);
    await core.assertFeatures(contentType, spaceId);
    if ((input.parentId ?? null) !== existing.parentId) {
      await core.assertPlacement(contentType, input.parentId ?? null, scopeOf(existing));
    }
    const hookContext = core.hookContext(contentType, actor, scopeOf(existing), existing);
    // No locale keeps the current one.
    if (!input.locale) input = { ...input, locale: existing.locale };

    const merged = mergeWritableFields(existing.fields, input.fields, contentType, actor);

    let prepared = await manablox.hooks.run(
      'content:beforeValidate',
      toWriteInput({ ...input, fields: merged }),
      hookContext,
    );
    const { fields, searchText } = await validateContent(
      registry,
      contentType,
      prepared.fields,
      input,
      actor,
      hookContext,
      await blockInstanceChecks(manablox, input.spaceId),
      existing.fields,
    );
    prepared = await manablox.hooks.run(
      'content:beforeUpdate',
      { ...prepared, fields },
      hookContext,
    );
    await core.assertUnique(contentType, prepared.fields, {
      spaceId: prepared.spaceId,
      environmentId: existing.environmentId,
      locale: prepared.locale,
      localizationId: existing.localizationId,
    });

    return core.transaction(async (tx) => {
      const row = await tx.repos.content
        .update(id, {
          spaceId: prepared.spaceId,
          typeId: prepared.typeId,
          locale: prepared.locale,
          parentId: prepared.parentId ?? null,
          title: prepared.title,
          slug: prepared.slug,
          fields: prepared.fields,
          searchText,
          ...(prepared.position !== undefined ? { position: prepared.position } : {}),
          hasSlug: contentType.hasSlug,
          actorId: actor?.userId ?? null,
          ...(input.source !== undefined ? { source: input.source } : {}),
          ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
          ...(input.expectedVersion !== undefined
            ? { expectedVersion: input.expectedVersion }
            : {}),
        })
        .catch(slugConflict({ slug: prepared.slug ?? '' }));

      await propagateSharedFields(tx.repos, row, contentType);
      await tx.listeners('content:afterUpdate', row, hookContext);
      await tx.after(() =>
        manablox.hooks.run('content:afterUpdate', row, tx.committedContext(hookContext)),
      );
      await tx.audit.record(action, row, diffRecords(existing, row, CONTENT_DIFF), meta);
      return row;
    });
  }

  async move(
    scope: Scope,
    id: string,
    parentId: string | null,
    position: number,
  ): Promise<ContentRow> {
    const { core } = this;
    const row = await core.find(scope, id);

    if (parentId) {
      const parent = await core.repos.content.findById(parentId);
      if (!parent || !inScope(parent, scopeOf(row))) {
        throw ManabloxError.badRequest('content.parent.notInSpace', { parentId });
      }
      if (parent.locale !== row.locale) {
        // Each locale has its own tree.
        throw ManabloxError.badRequest('content.parent.otherLocale', { parentId });
      }
    }
    await core.assertPlacement(core.registry.get(row.typeId), parentId, scopeOf(row));

    return core.transaction(async (tx) => {
      const moved = await tx.repos.content.move(id, parentId, position);
      await tx.audit.record('content.move', moved, diffRecords(row, moved, CONTENT_DIFF));
      return moved;
    });
  }

  async translations(
    scope: Scope,
    id: string,
  ): Promise<{ id: string; locale: string; status: string; title: string }[]> {
    const row = await this.core.find(scope, id);

    const all = await this.core.repos.content.listByLocalization(scopeOf(row), row.localizationId);
    return all
      .map((sibling) => ({
        id: sibling.id,
        locale: sibling.locale,
        status: sibling.status,
        title: sibling.title,
      }))
      .sort((a, b) => a.locale.localeCompare(b.locale));
  }

  async createTranslation(
    scope: Scope,
    id: string,
    locale: string,
    actor: Actor | null,
  ): Promise<ContentRow> {
    const source = await this.core.find(scope, id);
    if (source.locale === locale) {
      throw ManabloxError.badRequest('content.translation.sameLocale', { locale });
    }

    const existing = await this.core.repos.content.listByLocalization(
      scopeOf(source),
      source.localizationId,
    );
    const clash = existing.find((sibling) => sibling.locale === locale);
    if (clash) throw ManabloxError.conflict('content.translation.exists', { locale, id: clash.id });

    return this.create(
      {
        spaceId: source.spaceId,
        environmentId: source.environmentId,
        typeId: source.typeId,
        locale,
        localizationId: source.localizationId,
        parentId: source.parentId,
        title: source.title,
        slug: source.slug,
        fields: source.fields,
        position: source.position,
      },
      actor,
      undefined,
      source.fields,
    );
  }

  async delete(
    scope: Scope,
    id: string,
    actor: Actor | null,
    children: DeleteChildren,
  ): Promise<number> {
    const { core } = this;
    const { manablox, registry } = core;
    const spaceId = scopeSpaceId(scope);
    const existing = await core.find(scope, id);
    // The reconciler sets `source: 'runtime'` before deleting, so this never blocks it.
    if (existing.source === 'code') {
      throw ManabloxError.forbidden('content.code.immutable', { id, title: existing.title });
    }
    const type = registry.tryGet(existing.typeId);
    if (type) await core.assertFeatures(type, spaceId);
    const hookContext = core.hookContextFor(existing, actor);

    await manablox.hooks.run('content:beforeDelete', { id }, hookContext);
    return core.transaction(async (tx) => {
      const rows = await tx.repos.content.deleteReturning(id, children);
      const descendants = rows.filter((row) => row.id !== id);
      const deleted = [existing, ...descendants];
      // Home nomination, menus, tags and asset usages clean up here.
      await tx.listeners('content:afterDeleteMany', deleted, tx.manyHookContext(existing, actor));
      await tx.after(async () => {
        await manablox.hooks.run(
          'content:afterDelete',
          { id, record: existing },
          tx.committedContext(hookContext),
        );
        for (const row of descendants) {
          const type = registry.tryGet(row.typeId);
          if (!type) continue;
          await manablox.hooks.run(
            'content:afterDelete',
            { id: row.id, record: row },
            tx.committedContext(core.hookContext(type, actor, scopeOf(row))),
          );
        }
        await manablox.hooks.run(
          'content:afterDeleteMany',
          deleted,
          tx.committedContext(core.manyHookContext(existing, actor)),
        );
        await core.purge(existing, ...descendants);
      });
      await tx.repos.audit.recordMany([
        core.audit.entry(
          'content.delete',
          existing,
          snapshotChanges(existing, 'deleted', CONTENT_DIFF),
          { deleted: rows.length, children },
        ),
        ...descendants.map((row) =>
          core.audit.entry('content.delete', row, snapshotChanges(row, 'deleted', CONTENT_DIFF), {
            ancestorId: id,
          }),
        ),
      ]);
      return rows.length;
    });
  }
}
