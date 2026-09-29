import type { MediaPreset } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { AssetRow } from '@manablox/db';
import type { StagedUpload } from './stage.js';

export interface UploadInput {
  spaceId: string;
  filename: string;
  mimeType: string;
  /** The bytes, or a file `stageUpload` spooled; the caller discards a staged file. */
  body: Buffer | StagedUpload;
  alt?: string;
  title?: string;
  actorId?: string | null;
}

/** One preset variant for a worker to render. */
export interface DeriveJob {
  assetId: string;
  preset: string;
  format: string;
}

export type PresentedAsset = AssetRow & { url: string; thumbnailUrl: string | null };

/** A lock per variant key; `acquire` resolves to its release, or null while another holder has it. */
export interface VariantLock {
  acquire(key: string, ttlMs: number): Promise<(() => Promise<void>) | null>;
}

export interface MediaServiceOptions {
  /** The process ceiling; controls and space settings only narrow it. */
  maxFileSize: number;
  allowedMimeTypes: string[];
  /**
   * Presets declared by the content model, read live since types change at runtime.
   * Together with the config's, the only presets a transform may render.
   */
  declaredPresets?: () => Record<string, MediaPreset>;
  /** No writes to storage or the database; new variants render into `config.cachePath`. */
  readOnly?: boolean;
  /** Queues eager variants for a worker; without it they render inside the upload. */
  queueDerive?: ((job: DeriveJob) => Promise<void>) | undefined;
  /** Shared across processes so one variant renders once; in-process calls share a render regardless. */
  variantLock?: VariantLock | undefined;
  /** Runs the upload hooks and purges cached deliveries on writes. */
  manablox?: Manablox | undefined;
  /**
   * Takes over a deleted asset's original file, e.g. to keep it for snapshot restores; true
   * leaves it in storage. Variants are always deleted.
   */
  retainDeleted?:
    | ((asset: { id: string; keys: string[] }, spaceIds: string[]) => Promise<boolean>)
    | undefined;
}
