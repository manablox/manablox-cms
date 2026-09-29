import { type ContentTypeRegistry, ManabloxError, type ResourceSource } from '@manablox/core';
import { eq, inArray } from 'drizzle-orm';
import type { ContentRow } from '../../schema/index.js';
import type { DatabaseContext } from '../base.js';
import { ContentBase, type ContentWriteData, childPath, joinSegment } from './shared.js';
import type { ContentTree } from './tree.js';
import type { ContentVersions } from './versions.js';

/** Draft creation and editing; every edit bumps the version and takes a snapshot. */
export class ContentWrites extends ContentBase {
  constructor(
    context: DatabaseContext,
    private readonly tree: ContentTree,
    private readonly versions: ContentVersions,
    private readonly registry?: ContentTypeRegistry,
  ) {
    super(context);
  }

  async create(data: ContentWriteData): Promise<ContentRow> {
    const { contents } = this.t;
    return this.db.transaction(async (tx) => {
      const id = data.id ?? crypto.randomUUID();
      const path = childPath(await this.parentPath(tx, data.parentId ?? null), id);
      const parentPrefix = await this.parentPermalinkPath(tx, data.parentId ?? null);
      const segment = data.hasSlug ? data.slug : null;
      const permalinkPath = joinSegment(parentPrefix, segment);
      const permalink = segment === null ? null : permalinkPath;

      const [row] = await tx
        .insert(contents)
        .values({
          id,
          spaceId: data.spaceId,
          environmentId: this.environmentOf(data),
          typeId: data.typeId,
          locale: data.locale,
          localizationId: data.localizationId ?? crypto.randomUUID(),
          parentId: data.parentId ?? null,
          title: data.title,
          slug: data.slug,
          path,
          permalink,
          permalinkPath,
          permalinkSegment: segment,
          status: data.status ?? 'draft',
          position: data.position ?? 0,
          fields: data.fields,
          searchText: data.searchText ?? '',
          version: 1,
          source: data.source ?? 'runtime',
          sourceRef: data.sourceRef ?? null,
          createdBy: data.actorId ?? null,
          updatedBy: data.actorId ?? null,
        })
        .returning();

      if (!row) throw new ManabloxError('content.create.failed');
      await this.versions.snapshot(tx, row, data.actorId ?? null);
      await this.countRows(tx, this.registry, [row as ContentRow], 1);
      return row as ContentRow;
    });
  }

  async update(id: string, data: ContentWriteData): Promise<ContentRow> {
    const { contents } = this.t;
    return this.db.transaction(async (tx) => {
      const current = await this.lockRow(tx, id);

      if (data.expectedVersion !== undefined && data.expectedVersion !== current.version) {
        throw ManabloxError.conflict('content.version.conflict', {
          expected: data.expectedVersion,
          actual: current.version,
        });
      }

      const parentChanged = (data.parentId ?? null) !== current.parentId;
      const segment = data.hasSlug ? data.slug : null;
      const segmentChanged = segment !== current.permalinkSegment;

      if (parentChanged) {
        await this.tree.assertNotOwnDescendant(tx, id, data.parentId ?? null);
      }

      const newPath = childPath(await this.parentPath(tx, data.parentId ?? null), id);

      const [row] = await tx
        .update(contents)
        .set({
          typeId: data.typeId,
          locale: data.locale,
          parentId: data.parentId ?? null,
          title: data.title,
          slug: data.slug,
          path: newPath,
          permalinkSegment: segment,
          fields: data.fields,
          searchText: data.searchText ?? '',
          position: data.position ?? current.position,
          version: current.version + 1,
          ...(data.source !== undefined ? { source: data.source } : {}),
          ...(data.sourceRef !== undefined ? { sourceRef: data.sourceRef } : {}),
          updatedAt: new Date(),
          updatedBy: data.actorId ?? null,
        })
        .where(eq(contents.id, id))
        .returning();

      if (!row) throw ManabloxError.notFound('content.notFound', { id });

      if (parentChanged) {
        await this.tree.moveSubtree(tx, id, current.path, newPath);
      }

      if (parentChanged || segmentChanged) {
        await this.tree.recomputePermalinks(tx, contents, id);
      }

      const fresh = (await this.findRow(tx, id)) ?? (row as ContentRow);
      await this.versions.snapshot(tx, fresh, data.actorId ?? null);
      return fresh;
    });
  }

  /** Merges field values into rows, keeping concurrent edits to other fields. */
  async patchFields(ids: string[], patch: Record<string, unknown>): Promise<void> {
    if (ids.length === 0 || Object.keys(patch).length === 0) return;
    const { contents } = this.t;
    await this.db
      .update(contents)
      .set({
        fields: this.dialect.jsonMerge(contents.fields, patch),
        updatedAt: new Date(),
      })
      .where(inArray(contents.id, ids));
  }

  /** Changes ownership only: no version, no hook. */
  async setSource(id: string, source: ResourceSource, sourceRef: string | null): Promise<void> {
    const { contents } = this.t;
    await this.db.update(contents).set({ source, sourceRef }).where(eq(contents.id, id));
  }
}
