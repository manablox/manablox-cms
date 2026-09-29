/** Upload rules: the strictest of the process env, the controls and the space's own settings. */

import type { ResolvedUploadRules } from './controls/types.js';
import type { SpaceAssetSettings, StorageConfig } from './media-config.js';
import { intersectMimeTypes } from './mime.js';

/** Without `FILE_MAX_SIZE_MB` or `storage.maxFileSize`. */
export const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024;

export interface UploadRules {
  /** Bytes. */
  maxFileSize: number;
  /** Exact types or families (`image/`); `null` admits any type, `[]` none. */
  allowedMimeTypes: string[] | null;
}

/** The process ceiling; an empty env list admits any type. */
export function envUploadRules(
  storage: Pick<StorageConfig, 'maxFileSize' | 'allowedMimeTypes'>,
): UploadRules {
  const types = storage.allowedMimeTypes ?? [];
  return {
    maxFileSize: storage.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
    allowedMimeTypes: types.length ? [...types] : null,
  };
}

/** `rules` narrowed by the controls, then by the space's own settings. */
export function narrowUploadRules(
  rules: UploadRules,
  controls: ResolvedUploadRules | null,
  space: SpaceAssetSettings | null = null,
): UploadRules {
  const spaceTypes = space?.allowedMimeTypes?.length ? space.allowedMimeTypes : null;
  return {
    maxFileSize: Math.min(
      rules.maxFileSize,
      controls?.maxFileSize ?? Number.POSITIVE_INFINITY,
      space?.maxFileSize && space.maxFileSize > 0 ? space.maxFileSize : Number.POSITIVE_INFINITY,
    ),
    allowedMimeTypes: intersectMimeTypes(
      intersectMimeTypes(rules.allowedMimeTypes, controls?.allowedMimeTypes ?? null),
      spaceTypes,
    ),
  };
}

/** True when the rules admit `mimeType`. */
export function uploadTypeAllowed(mimeType: string, rules: UploadRules): boolean {
  const allowed = rules.allowedMimeTypes;
  if (allowed === null) return true;
  return allowed.some((entry) =>
    entry.endsWith('/') ? mimeType.startsWith(entry) : mimeType === entry,
  );
}
