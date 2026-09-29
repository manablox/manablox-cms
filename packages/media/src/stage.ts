import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ManabloxError } from '@manablox/core';

/** Bytes kept for type sniffing. */
const HEAD_BYTES = 64;

/** An upload spooled to a temp file, hashed and counted on the way. */
export interface StagedUpload {
  path: string;
  size: number;
  /** SHA-256, hex. */
  checksum: string;
  /** The first bytes, for type sniffing. */
  head: Buffer;
  /** Removes the temp file. */
  discard(): Promise<void>;
}

/** Spools `source` to a temp file; past `maxFileSize` it fails with `asset.tooLarge` and stops reading. */
export async function stageUpload(
  source: Readable | AsyncIterable<Uint8Array>,
  maxFileSize: number,
  dir: string = tmpdir(),
): Promise<StagedUpload> {
  const folder = await mkdtemp(join(dir, 'manablox-upload-'));
  const discard = () => rm(folder, { recursive: true, force: true });
  const path = join(folder, 'file');
  const hash = createHash('sha256');
  const head: Buffer[] = [];
  let headSize = 0;
  let size = 0;

  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > maxFileSize) {
        done(ManabloxError.tooLarge('asset.tooLarge', { max: maxFileSize }));
        return;
      }
      hash.update(chunk);
      if (headSize < HEAD_BYTES) {
        head.push(chunk.subarray(0, HEAD_BYTES - headSize));
        headSize += Math.min(chunk.length, HEAD_BYTES - headSize);
      }
      done(null, chunk);
    },
  });

  try {
    await pipeline(source, counter, createWriteStream(path));
  } catch (error) {
    await discard();
    throw error;
  }
  return { path, size, checksum: hash.digest('hex'), head: Buffer.concat(head), discard };
}
