/** Storage drivers, upload limits and image presets. */

/** The local driver: a directory on disk. */
export interface LocalStorageConfig {
  path: string;
  /** Base URL a reverse proxy serves the directory from, if any. */
  publicUrl?: string;
}

/** The S3 driver: a bucket on AWS or an S3-compatible service. */
export interface S3StorageConfig {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Required for MinIO and most S3-compatible services. */
  forcePathStyle?: boolean;
  /** Base URL originals are served from directly, if any. */
  publicUrl?: string;
}

export interface StorageConfig {
  driver: string;
  local?: LocalStorageConfig;
  s3?: S3StorageConfig;
  maxFileSize?: number;
  allowedMimeTypes?: string[];
}

export interface MediaPreset {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'inside' | 'outside' | 'fill';
  format?: 'avif' | 'webp' | 'jpeg' | 'png';
  quality?: number;
}

/** A space's upload limits (`spaces.settings.assets`); they only narrow `StorageConfig`. */
export interface SpaceAssetSettings {
  /** Exact types (`image/png`) or families with a trailing slash (`image/`). */
  allowedMimeTypes?: string[];
  /** Bytes. */
  maxFileSize?: number;
}

export interface MediaConfig {
  presets?: Record<string, MediaPreset>;
  /** Formats generated eagerly on upload; everything else is on demand. */
  eager?: string[];
  signingSecret?: string;
  cachePath?: string;
}

export const DEFAULT_MEDIA_PRESETS: Record<string, MediaPreset> = {
  thumb: { width: 320, height: 320, fit: 'inside', format: 'webp', quality: 80 },
  card: { width: 640, fit: 'inside', format: 'webp', quality: 82 },
  hero: { width: 1920, fit: 'inside', format: 'webp', quality: 84 },
};
