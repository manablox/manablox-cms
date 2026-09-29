import {
  diffRecords,
  ManabloxError,
  purgeTags,
  redirectsCacheTag,
  type Scope,
  scopeOf,
  scopeSpaceId,
} from '@manablox/core';
import type { ContentRow } from '@manablox/db';
import { recordPermalinkChanges } from '../redirect.service.js';
import { CONTENT_DIFF, type ContentCore } from './core.js';
import type { Actor, ContentSchedule } from './types.js';
import type { ContentWrites } from './writes.js';

/** Publish, schedule, unpublish and version restore. */
export class ContentPublishing {
  constructor(
    private readonly core: ContentCore,
    private readonly writes: ContentWrites,
  ) {}

  async publish(scope: Scope, id: string, actor: Actor | null): Promise<ContentRow> {
    const { core } = this;
    const spaceId = scopeSpaceId(scope);
    const existing = await core.find(scope, id);

    const contentType = core.registry.get(existing.typeId);
    if (!contentType.isPublishable) {
      throw ManabloxError.badRequest('content.type.notPublishable', { type: contentType.name });
    }
    await core.assertFeatures(contentType, spaceId);
    const hookContext = core.hookContext(contentType, actor, scopeOf(existing));
    await core.assertUnique(contentType, existing.fields, existing, true);

    await core.manablox.hooks.run('content:beforePublish', existing, hookContext);
    return core.transaction(async (tx) => {
      // A moved node takes its live descendants' permalinks along; otherwise only its own changes.
      const [live] = await tx.repos.content.publishedPermalinks(id, false);
      const moved = live !== undefined && live.permalinkPath !== existing.permalinkPath;
      const before = moved
        ? await tx.repos.content.publishedPermalinks(id, true)
        : live
          ? [live]
          : [];
      const row = await tx.repos.content.publish(id, actor?.userId ?? null);
      const after = await tx.repos.content.publishedPermalinks(id, moved);
      if (await recordPermalinkChanges(core.manablox, tx.repos, scopeOf(row), before, after)) {
        await tx.after(() =>
          purgeTags(core.manablox, row.spaceId, [redirectsCacheTag(row.spaceId)]),
        );
      }
      // Approvals and asset usages follow here.
      await tx.listeners('content:afterPublish', row, hookContext);
      await tx.after(async () => {
        await core.manablox.hooks.run(
          'content:afterPublish',
          row,
          tx.committedContext(hookContext),
        );
        await core.purge(row);
      });
      await tx.audit.record('content.publish', row, diffRecords(existing, row, CONTENT_DIFF), {
        version: row.version,
      });
      return row;
    });
  }

  async schedule(scope: Scope, id: string, schedule: ContentSchedule): Promise<ContentRow> {
    const { core } = this;
    const spaceId = scopeSpaceId(scope);
    const existing = await core.find(scope, id);

    const contentType = core.registry.get(existing.typeId);
    if (!contentType.isPublishable) {
      throw ManabloxError.badRequest('content.schedule.notPublishable', {
        type: contentType.name,
      });
    }
    await core.assertFeatures(contentType, spaceId);
    // Clearing a schedule stays allowed.
    if (schedule.publishAt || schedule.unpublishAt) {
      await core.manablox.controls.assertFeature(spaceId, 'scheduledPublishing');
    }

    const publishAt = schedule.publishAt === undefined ? existing.publishAt : schedule.publishAt;
    const unpublishAt =
      schedule.unpublishAt === undefined ? existing.unpublishAt : schedule.unpublishAt;
    // Otherwise the scheduler would publish and unpublish in the same tick.
    if (publishAt && unpublishAt && unpublishAt <= publishAt) {
      throw ManabloxError.badRequest('content.schedule.invalidWindow', {
        publishAt: publishAt.toISOString(),
        unpublishAt: unpublishAt.toISOString(),
      });
    }

    return core.transaction(async (tx) => {
      const row = await tx.repos.content.setSchedule(id, { publishAt, unpublishAt });
      await tx.audit.record('content.schedule', row, diffRecords(existing, row, CONTENT_DIFF), {
        publishAt: publishAt?.toISOString() ?? null,
        unpublishAt: unpublishAt?.toISOString() ?? null,
      });
      return row;
    });
  }

  async unpublish(scope: Scope, id: string, actor: Actor | null): Promise<void> {
    const { core } = this;
    const { manablox } = core;
    const spaceId = scopeSpaceId(scope);
    const existing = await core.find(scope, id);
    await core.assertFeatures(core.registry.get(existing.typeId), spaceId);
    const hookContext = core.hookContextFor(existing, actor);

    await manablox.hooks.run('content:beforeUnpublish', { id }, hookContext);
    await core.transaction(async (tx) => {
      const rows = await tx.repos.content.unpublish(id);
      const descendants = rows.filter((row) => row.id !== id);
      await tx.listeners('content:afterUnpublishMany', rows, tx.manyHookContext(existing, actor));
      await tx.after(async () => {
        await manablox.hooks.run(
          'content:afterUnpublish',
          { id },
          tx.committedContext(hookContext),
        );
        for (const row of descendants) {
          await manablox.hooks.run(
            'content:afterUnpublish',
            { id: row.id },
            tx.committedContext(core.hookContextFor(row, actor)),
          );
        }
        await manablox.hooks.run(
          'content:afterUnpublishMany',
          rows,
          tx.committedContext(core.manyHookContext(existing, actor)),
        );
        await core.purge(existing, ...descendants);
      });
      await tx.repos.audit.recordMany([
        core.audit.entry('content.unpublish', existing, []),
        ...descendants.map((row) =>
          core.audit.entry('content.unpublish', row, [], { ancestorId: id }),
        ),
      ]);
    });
  }

  async restore(
    scope: Scope,
    id: string,
    version: number,
    actor: Actor | null,
  ): Promise<ContentRow> {
    const spaceId = scopeSpaceId(scope);
    await this.core.find(scope, id);
    await this.core.manablox.controls.assertFeature(spaceId, 'versionRestore');
    const row = await this.core.repos.content.findVersionSnapshot(id, version);
    if (!row) throw ManabloxError.notFound('content.version.notFound', { id, version });

    return this.writes.save(
      scope,
      id,
      {
        spaceId,
        typeId: row.typeId,
        locale: row.locale,
        parentId: row.parentId,
        title: row.title,
        slug: row.slug,
        fields: row.fields,
        position: row.position,
      },
      actor,
      'content.restore',
      { version },
    );
  }
}
