import type { Readable } from 'node:stream';

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

/** An object found under a prefix. */
export interface ListedObject {
  key: string;
  size: number;
  lastModified: Date;
}

/** Inclusive byte offsets of a part of an object. */
export interface ByteRange {
  start: number;
  end: number;
}

export interface PutOptions {
  contentType: string;
  /** Cache-Control for drivers that serve bytes directly. */
  cacheControl?: string;
}

/** Pluggable object storage; the config selects a driver by name. */
export interface StorageDriver {
  readonly name: string;

  put(key: string, body: Buffer | Readable, options: PutOptions): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  /** The object's bytes; with `range` only those, which a driver must honour exactly. */
  stream(key: string, range?: ByteRange): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Every object whose key starts with `prefix`, sorted by key. */
  list?(prefix: string): Promise<ListedObject[]>;
  /** Removes whatever is left under a key prefix, e.g. empty directories. */
  deletePrefix?(prefix: string): Promise<void>;
  /** Public URL, when the driver serves bytes without the API. */
  url(key: string): string | null;
  /** Time-limited direct upload URL. */
  presignPut?(key: string, contentType: string, expiresIn: number): Promise<string>;
}

export type StorageDriverFactory = (config: Record<string, unknown>) => StorageDriver;

/** Whether a driver error means the object is absent: ENOENT locally, 404 on S3. */
export function isMissingObject(error: unknown): boolean {
  const e = error as {
    code?: string;
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    e?.code === 'ENOENT' ||
    e?.name === 'NotFound' ||
    e?.name === 'NoSuchKey' ||
    e?.Code === 'NoSuchKey' ||
    e?.$metadata?.httpStatusCode === 404
  );
}
