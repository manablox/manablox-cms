import {
  diffRecords,
  envUploadRules,
  ManabloxError,
  type SpaceAssetSettings,
  withinInstance,
} from '@manablox/core';
import type { SpaceRow } from '@manablox/db';
import type { SpaceContext } from './context.js';

/**
 * Upload limits may only narrow the env ceiling and the control-owned bounds; wider ones are
 * refused, naming the bound. `{}` resets.
 */
export async function setAssetSettings(
  ctx: SpaceContext,
  spaceId: string,
  input: SpaceAssetSettings,
): Promise<SpaceRow> {
  const space = await ctx.require(spaceId);
  const instance = envUploadRules(ctx.manablox.config.storage);
  const controls = (await ctx.manablox.controls.resolved(spaceId)).uploads;
  const admits = (allowed: string[] | null, entry: string) =>
    allowed === null || (allowed.length > 0 && withinInstance(entry, allowed));

  const details: Array<{
    key:
      | 'space.assets.mimeType.outsideInstance'
      | 'space.assets.mimeType.outsideControl'
      | 'space.assets.maxFileSize.aboveInstance'
      | 'space.assets.maxFileSize.aboveControl';
    path: (string | number)[];
    params: Record<string, unknown>;
  }> = [];
  for (const [index, entry] of (input.allowedMimeTypes ?? []).entries()) {
    const outside = !admits(instance.allowedMimeTypes, entry)
      ? 'space.assets.mimeType.outsideInstance'
      : !admits(controls.allowedMimeTypes, entry)
        ? 'space.assets.mimeType.outsideControl'
        : null;
    if (outside) {
      details.push({
        key: outside,
        path: ['allowedMimeTypes', index],
        params: { mimeType: entry },
      });
    }
  }
  if (input.maxFileSize && input.maxFileSize > instance.maxFileSize) {
    details.push({
      key: 'space.assets.maxFileSize.aboveInstance',
      path: ['maxFileSize'],
      params: { max: instance.maxFileSize },
    });
  } else if (
    input.maxFileSize &&
    controls.maxFileSize !== null &&
    input.maxFileSize > controls.maxFileSize
  ) {
    details.push({
      key: 'space.assets.maxFileSize.aboveControl',
      path: ['maxFileSize'],
      params: { max: controls.maxFileSize },
    });
  }
  if (details.length) throw ManabloxError.validation(details, 'space.validation.failed');

  const assets: SpaceAssetSettings = {};
  if (input.allowedMimeTypes) assets.allowedMimeTypes = input.allowedMimeTypes;
  if (input.maxFileSize) assets.maxFileSize = input.maxFileSize;

  const settings = { ...space.settings };
  if (Object.keys(assets).length) settings.assets = assets;
  else delete settings.assets;
  return ctx.repos.transaction(async (tx) => {
    const saved = await tx.spaces.update(spaceId, { settings });
    await ctx.audit
      .in(tx)
      .record(
        'space.setAssetSettings',
        saved,
        diffRecords({ assets: space.settings.assets }, { assets: saved.settings.assets }),
      );
    return saved;
  });
}
