import { createReadStream } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { ManabloxError } from '@manablox/core';
import { type ArchiveManifest, DEFAULT_ARCHIVE_LIMITS, readManifest } from './archive.js';

/** Zip local file header signature. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Same limit as the archive manifest; larger JSON would exhaust the heap. */
const MAX_JSON_BYTES = DEFAULT_ARCHIVE_LIMITS.maxEntryBytes;

/** Reads an uploaded export, detecting zip vs JSON from the bytes. `manifest` is set only for a zip. */
export async function readUploadedExport(
  path: string,
  maxJsonBytes: number = MAX_JSON_BYTES,
): Promise<{ manifest: ArchiveManifest | null; payload: unknown }> {
  if (await looksZipped(path)) {
    const manifest = await readManifest(createReadStream(path));
    return { manifest, payload: manifest };
  }
  return { manifest: null, payload: await readExport(path, maxJsonBytes) };
}

async function looksZipped(path: string): Promise<boolean> {
  const file = await open(path, 'r');
  try {
    const head = Buffer.alloc(ZIP_MAGIC.length);
    const { bytesRead } = await file.read(head, 0, head.length, 0);
    return bytesRead === head.length && head.equals(ZIP_MAGIC);
  } finally {
    await file.close();
  }
}

async function readExport(path: string, maxJsonBytes: number): Promise<unknown> {
  const { size } = await stat(path);
  if (size > maxJsonBytes) {
    throw ManabloxError.badRequest('space.import.tooLarge', { maxEntryBytes: maxJsonBytes });
  }
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw ManabloxError.badRequest('space.import.notAnExport');
  }
}
