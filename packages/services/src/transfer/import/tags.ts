import type { Repositories } from '@manablox/db';
import { toTagInputs } from '../../tag.service.js';
import type { ExportedAsset, ExportedContent } from '../format.js';

/** Recreates the vocabulary in the target space and re-applies every assignment. */
export async function importTags(
  repos: Repositories,
  spaceId: string,
  contents: ExportedContent[],
  assets: ExportedAsset[],
  actorId: string | null,
): Promise<void> {
  // Capped per carrier, not across the whole vocabulary.
  const bySlugInput = new Map(
    [...contents, ...assets]
      .flatMap((carrier) => toTagInputs(carrier.tags ?? []))
      .map((input) => [input.slug, input]),
  );
  const inputs = [...bySlugInput.values()];
  if (inputs.length === 0) return;

  const rows = await repos.tags.ensure(spaceId, inputs, actorId);
  const bySlug = new Map(rows.map((row) => [row.slug, row.id]));
  const idsOf = (wanted: string[]): string[] =>
    toTagInputs(wanted)
      .map((input) => bySlug.get(input.slug))
      .filter((id): id is string => Boolean(id));

  // One group per localization, whichever translation carried the names. The space is
  // new, so assignments are only added.
  const done = new Set<string>();
  const documentRows: Array<{ tagId: string; localizationId: string; spaceId: string }> = [];
  for (const content of contents) {
    if (!content.tags?.length || done.has(content.localizationId)) continue;
    done.add(content.localizationId);
    for (const tagId of new Set(idsOf(content.tags))) {
      documentRows.push({ tagId, localizationId: content.localizationId, spaceId });
    }
  }
  const assetRows = assets.flatMap((asset) =>
    [...new Set(idsOf(asset.tags ?? []))].map((tagId) => ({ tagId, assetId: asset.id })),
  );
  await repos.tags.seedForLocalizations(documentRows);
  await repos.tags.seedForAssets(assetRows);
}
