import type { Manablox } from '@manablox/core/node';
import type { ContentRow } from '@manablox/db';
import { onWrite } from './content/listeners.js';
import type { ContentService } from './content/service.js';

/** Keeps `asset_usages` in step with content writes via each field type's `references()`. */
export function attachAssetUsages(manablox: Manablox, content: ContentService): void {
  const assetIdsOf = (row: ContentRow): string[] =>
    content
      .collectReferences(row)
      .filter((reference) => reference.target === 'asset')
      .map((reference) => reference.id);

  // Each runs in the write's transaction.
  onWrite(manablox, 'content:afterCreate', async (row, _context, tx) => {
    await tx.assetUsages.recordDraft(row.id, row.spaceId, assetIdsOf(row as ContentRow));
  });
  onWrite(manablox, 'content:afterUpdate', async (row, _context, tx) => {
    await tx.assetUsages.recordDraft(row.id, row.spaceId, assetIdsOf(row as ContentRow));
  });
  onWrite(manablox, 'content:afterPublish', async (row, _context, tx) => {
    await tx.assetUsages.recordPublished(row.id, row.spaceId, assetIdsOf(row as ContentRow));
  });
  onWrite(manablox, 'content:afterUnpublishMany', async (rows, _context, tx) => {
    await tx.assetUsages.clearPublished(rows.map((row) => row.id));
  });
  // Explicit despite the cascade, in case the constraint is bypassed.
  onWrite(manablox, 'content:afterDeleteMany', async (rows, _context, tx) => {
    await tx.assetUsages.deleteByContent(rows.map((row) => row.id));
  });
}
