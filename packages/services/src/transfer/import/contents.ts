import type { ContentTypeDefinition } from '@manablox/core';
import { ManabloxError } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { ContentRow, Repositories } from '@manablox/db';
import { collectReferences } from '../../content/references.js';
import { dateOf, dateOrNull, depth, type ExportedContent } from '../format.js';
import { existingAssets } from './assets.js';

/** Refuses documents whose type neither arrives nor exists, naming every missing type. */
export function assertTypesKnown(
  manablox: Manablox,
  contents: ExportedContent[],
  contentTypes: ContentTypeDefinition[],
): void {
  const arriving = new Set(contentTypes.map((type) => type.id));
  const missing = new Map<string, number>();
  for (const content of contents) {
    if (arriving.has(content.typeId) || manablox.contentTypes.tryGet(content.typeId)) {
      continue;
    }
    missing.set(content.typeId, (missing.get(content.typeId) ?? 0) + 1);
  }
  if (missing.size === 0) return;
  throw ManabloxError.badRequest('space.import.typeMissing', {
    typeIds: [...missing.keys()],
    documents: [...missing.values()].reduce((sum, count) => sum + count, 0),
  });
}

export async function importContents(
  manablox: Manablox,
  repos: Repositories,
  contents: ExportedContent[],
  spaceId: string,
  actorId: string | null,
  withHistory: boolean,
): Promise<{ rows: ContentRow[]; published: string[]; versions: number }> {
  // Parents first; children derive path and permalink from them.
  const ordered = [...contents].sort((a, b) => depth(a.path) - depth(b.path));
  const rows: ContentRow[] = [];
  const published: string[] = [];
  const history: Parameters<Repositories['content']['restoreHistoryMany']>[0] = [];
  let versions = 0;

  for (const content of ordered) {
    const contentType = manablox.contentTypes.get(content.typeId);
    const row = await repos.content.create({
      id: content.id,
      spaceId,
      typeId: content.typeId,
      locale: content.locale,
      localizationId: content.localizationId,
      parentId: content.parentId,
      title: content.title,
      slug: content.slug,
      fields: content.fields,
      position: content.position,
      status: content.status as 'draft' | 'published' | 'archived',
      hasSlug: contentType.hasSlug,
      actorId,
    });
    // Without history, the snapshot `create()` wrote stays.
    const snapshots = withHistory ? (content.versions ?? []) : [];
    history.push({
      id: content.id,
      version: content.version,
      createdAt: dateOf(content.createdAt),
      updatedAt: dateOf(content.updatedAt),
      versions: snapshots.map((version) => ({
        ...version,
        createdAt: new Date(version.createdAt),
      })),
    });
    versions += snapshots.length;
    rows.push(row);
    if (content.status === 'published') published.push(content.id);
  }
  // One write for the whole import; the rows are independent.
  await repos.content.restoreHistoryMany(history);
  return { rows, published, versions };
}

/** Restores publish dates and scheduling windows. */
export async function restoreContentDates(
  repos: Repositories,
  contents: ExportedContent[],
): Promise<void> {
  await repos.content.restoreDatesMany(
    contents
      .filter((content) => content.publishedAt || content.publishAt || content.unpublishAt)
      .map((content) => ({
        id: content.id,
        publishedAt: content.publishedAt ? dateOf(content.publishedAt) : null,
        publishAt: dateOrNull(content.publishAt),
        unpublishAt: dateOrNull(content.unpublishAt),
      })),
  );
}

export async function recordAssetUsages(
  manablox: Manablox,
  repos: Repositories,
  rows: ContentRow[],
  published: string[],
): Promise<void> {
  const isPublished = new Set(published);
  const referenced = rows.map((row) => ({
    row,
    assetIds: collectReferences(manablox.contentTypes, row)
      .filter((reference) => reference.target === 'asset')
      .map((reference) => reference.id),
  }));
  // Foreign key: only existing assets are recorded.
  const existing = await existingAssets(repos, [
    ...new Set(referenced.flatMap((entry) => entry.assetIds)),
  ]);
  // Seeded, not reconciled: the space is new.
  await repos.assetUsages.seed(
    referenced.flatMap(({ row, assetIds }) =>
      assetIds
        .filter((id) => existing.has(id))
        .map((assetId) => ({
          assetId,
          contentId: row.id,
          spaceId: row.spaceId,
          published: isPublished.has(row.id),
        })),
    ),
  );
}
