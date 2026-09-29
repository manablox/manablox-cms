import type { Repositories } from '@manablox/db';
import { dateOf, dateOrNull, type ExportedAsset } from '../format.js';

/** The ids among `ids` that already have an asset row. */
export async function existingAssets(repos: Repositories, ids: string[]): Promise<Set<string>> {
  return new Set((await repos.assets.listByIds(ids)).map((row) => row.id));
}

/** Assets are shared between spaces; an existing one only gets this space added. */
export async function importAssets(
  repos: Repositories,
  spaceId: string,
  assets: ExportedAsset[],
  actorId: string | null,
): Promise<void> {
  const known = await existingAssets(
    repos,
    assets.map((asset) => asset.id),
  );
  for (const asset of assets) {
    if (known.has(asset.id)) {
      await repos.assets.addToSpace(asset.id, spaceId);
      continue;
    }
    await repos.assets.create({
      ...asset,
      spaceId,
      publishAt: dateOrNull(asset.publishAt),
      unpublishAt: dateOrNull(asset.unpublishAt),
      actorId,
    });
    await repos.assets.restoreTimestamps(
      asset.id,
      dateOf(asset.createdAt),
      dateOf(asset.updatedAt),
    );
  }
}
