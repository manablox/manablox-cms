import type {
  ResolvedUploadRules,
  SpaceAssetSettings,
  StorageConfig,
  UploadRules,
} from '@manablox/core';
import { envUploadRules, narrowUploadRules } from '@manablox/core';

export {
  mimeTypeAllowed,
  type UploadRules,
  uploadTypeAllowed,
  withinInstance,
} from '@manablox/core';

/** A space's upload rules and the bounds they come from. */
export interface UploadRuleSet {
  /** What uploads to the space accept. */
  effective: UploadRules;
  /** Env and controls: what the space's own settings may narrow. */
  ceiling: UploadRules;
  /** The process env alone. */
  instance: UploadRules;
  /** The control-owned bounds; `null` is unset. */
  controls: ResolvedUploadRules;
}

/** The strictest of env, controls and the space's own settings. */
export function resolveUploadRules(
  env: Pick<StorageConfig, 'allowedMimeTypes' | 'maxFileSize'>,
  controls: ResolvedUploadRules | null,
  space: SpaceAssetSettings | null | undefined,
): UploadRuleSet {
  const instance = envUploadRules(env);
  const ceiling = narrowUploadRules(instance, controls);
  return {
    effective: narrowUploadRules(ceiling, null, space ?? null),
    ceiling,
    instance,
    controls: controls ?? { maxFileSize: null, allowedMimeTypes: null },
  };
}

/** Reads the asset settings from a space's free-form settings, leniently. */
export function readSpaceAssetSettings(
  settings: Record<string, unknown> | null | undefined,
): SpaceAssetSettings | null {
  const block = settings?.assets as Partial<SpaceAssetSettings> | undefined;
  if (!block || typeof block !== 'object') return null;
  const out: SpaceAssetSettings = {};
  if (Array.isArray(block.allowedMimeTypes)) {
    out.allowedMimeTypes = block.allowedMimeTypes.filter(
      (entry): entry is string => typeof entry === 'string',
    );
  }
  if (typeof block.maxFileSize === 'number' && block.maxFileSize > 0) {
    out.maxFileSize = block.maxFileSize;
  }
  return out;
}
