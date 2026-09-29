import { type ContentTypeDefinition, scopeOf } from '@manablox/core';
import type { ContentRow, Repositories } from '@manablox/db';

/** Copies `localized: false` fields to the other translations' drafts. */
export async function propagateSharedFields(
  repos: Repositories,
  row: ContentRow,
  contentType: ContentTypeDefinition,
): Promise<void> {
  const shared = contentType.fields.filter((field) => !field.localized);
  if (shared.length === 0) return;

  const siblingIds = await repos.content.listLocalizationSiblingIds(
    scopeOf(row),
    row.localizationId,
    row.id,
  );
  if (siblingIds.length === 0) return;

  const patch: Record<string, unknown> = {};
  for (const field of shared) {
    if (field.name in row.fields) patch[field.name] = row.fields[field.name];
  }
  await repos.content.patchFields(siblingIds, patch);
}
