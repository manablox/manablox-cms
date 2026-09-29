import { ManabloxError } from '@manablox/core';
import {
  type ImportFileSink,
  SPACE_EXPORT_SECTIONS,
  type SpaceExport,
  type SpaceExportSection,
} from '@manablox/services';
import type { StorageDriver } from '@manablox/storage';
import { strFromU8, strToU8, Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate';

/** A space export zip: the JSON manifest first, then every asset file it names. */
const MANIFEST_NAME = 'space.json';
const FILES_PREFIX = 'files/';

/** Core's export sections plus `files`. */
const ARCHIVE_SECTIONS = [...SPACE_EXPORT_SECTIONS, 'files'] as const;

/** A core section, `files`, or a data provider's kind. */
export type ArchiveSection = (typeof ARCHIVE_SECTIONS)[number] | SpaceExportSection;

export interface ArchiveManifest extends SpaceExport {
  /** Number of asset files after the manifest. */
  archive: { files: number };
}

/** Whether `value` is a core section, `files`, or one of the data provider `kinds`. */
export function isArchiveSection(
  value: string,
  kinds: readonly string[] = [],
): value is ArchiveSection {
  return (ARCHIVE_SECTIONS as readonly string[]).includes(value) || kinds.includes(value);
}

/** Inflation limits per entry and per archive, against zip bombs; entries are buffered whole. */
export interface ArchiveLimits {
  maxEntryBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024 * 1024,
};

/** Larger manifests are refused before `JSON.parse` exhausts the heap. */
const MANIFEST_MAX_BYTES = DEFAULT_ARCHIVE_LIMITS.maxEntryBytes;

/**
 * Streams the manifest, then each asset still in storage (stored, not deflated). Honours
 * backpressure so a slow download does not buffer the bucket.
 */
export function writeArchive(
  payload: SpaceExport,
  storage: StorageDriver,
): { stream: ReadableStream<Uint8Array>; files: Promise<number> } {
  let resolveFiles: (count: number) => void = () => {};
  const files = new Promise<number>((resolve) => {
    resolveFiles = resolve;
  });

  let wanted: (() => void) | null = null;
  const whenWanted = (controller: ReadableStreamDefaultController<Uint8Array>) =>
    (controller.desiredSize ?? 1) > 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          wanted = resolve;
        });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip((error, chunk, final) => {
        if (error) {
          controller.error(error);
          return;
        }
        controller.enqueue(chunk);
        if (final) controller.close();
      });

      void (async () => {
        try {
          const present: NonNullable<SpaceExport['assets']> = [];
          for (const asset of payload.assets ?? []) {
            if (await storage.exists(asset.key)) present.push(asset);
          }
          resolveFiles(present.length);

          const manifest: ArchiveManifest = { ...payload, archive: { files: present.length } };
          const entry = new ZipDeflate(MANIFEST_NAME, { level: 6 });
          zip.add(entry);
          // Compact: indenting would add megabytes for a reader that holds it in memory.
          entry.push(strToU8(JSON.stringify(manifest)), true);

          for (const asset of present) {
            const file = new ZipPassThrough(FILES_PREFIX + asset.key);
            zip.add(file);
            for await (const chunk of await storage.stream(asset.key)) {
              await whenWanted(controller);
              file.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk));
            }
            file.push(new Uint8Array(0), true);
          }
          zip.end();
        } catch (error) {
          resolveFiles(0);
          controller.error(error);
        }
      })();
    },
    pull() {
      wanted?.();
      wanted = null;
    },
  });

  return { stream, files };
}

/** Reads the manifest (the first entry) and stops. */
export async function readManifest(source: AsyncIterable<Uint8Array>): Promise<ArchiveManifest> {
  let manifest: ArchiveManifest | null = null;
  await scanArchive(
    source,
    (name) => {
      if (name !== MANIFEST_NAME) return null;
      return (bytes) => {
        manifest = JSON.parse(strFromU8(bytes)) as ArchiveManifest;
        return Promise.resolve(true);
      };
    },
    { maxEntryBytes: MANIFEST_MAX_BYTES, maxTotalBytes: MANIFEST_MAX_BYTES },
  );
  if (!manifest) throw ManabloxError.badRequest('space.import.notAnExport');
  return manifest;
}

/** Stores the files the manifest lists, ignoring others. Returns the count written. */
export async function extractFiles(
  source: AsyncIterable<Uint8Array>,
  contentTypes: Map<string, string>,
  storage: ImportFileSink,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): Promise<number> {
  let stored = 0;
  await scanArchive(
    source,
    (name) => {
      if (!name.startsWith(FILES_PREFIX)) return null;
      const key = name.slice(FILES_PREFIX.length);
      const contentType = contentTypes.get(key);
      if (!contentType) return null;
      return async (bytes) => {
        await storage.put(key, Buffer.from(bytes), { contentType });
        stored++;
        return false;
      };
    },
    limits,
  );
  return stored;
}

/** One pass over an archive; `select` picks entries and handles their bytes, `true` stops. */
async function scanArchive(
  source: AsyncIterable<Uint8Array>,
  select: (name: string) => ((bytes: Uint8Array) => Promise<boolean>) | null,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): Promise<void> {
  const ready: Array<{ handle: (bytes: Uint8Array) => Promise<boolean>; bytes: Uint8Array }> = [];
  let failure: Error | null = null;
  let total = 0;

  const unzip = new Unzip((file) => {
    const handle = select(file.name);
    if (!handle) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error) {
        failure = error;
        return;
      }
      // Count inflated bytes; header sizes can lie.
      size += chunk.length;
      total += chunk.length;
      if (size > limits.maxEntryBytes || total > limits.maxTotalBytes) {
        failure = ManabloxError.badRequest('space.import.tooLarge', {
          entry: file.name,
          maxEntryBytes: limits.maxEntryBytes,
          maxTotalBytes: limits.maxTotalBytes,
        });
        return;
      }
      chunks.push(chunk);
      if (final) ready.push({ handle, bytes: concat(chunks) });
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  for await (const chunk of source) {
    unzip.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk), false);
    if (failure) throw failure;
    while (ready.length) {
      const next = ready.shift() as (typeof ready)[number];
      if (await next.handle(next.bytes)) return;
    }
  }
  unzip.push(new Uint8Array(0), true);
  if (failure) throw failure;
  while (ready.length) {
    const next = ready.shift() as (typeof ready)[number];
    if (await next.handle(next.bytes)) return;
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0] as Uint8Array;
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
