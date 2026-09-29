import { Readable } from 'node:stream';
import { ids } from '@manablox/core/testing';
import type { SpaceExport } from '@manablox/services';
import type { StorageDriver, StoredObject } from '@manablox/storage';
import { describe, expect, it } from 'vitest';
import { extractFiles, readManifest, writeArchive } from '../src/transfer/archive.js';

/** A bucket in a map; enough to see what the archive reads and writes. */
function memoryStorage(initial: Record<string, Buffer> = {}): StorageDriver & {
  objects: Map<string, Buffer>;
} {
  const objects = new Map(Object.entries(initial));
  return {
    name: 'memory',
    objects,
    async put(key, body): Promise<StoredObject> {
      const chunks: Buffer[] = [];
      if (Buffer.isBuffer(body)) {
        chunks.push(body);
      } else {
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      objects.set(key, buffer);
      return { key, size: buffer.length } as StoredObject;
    },
    async get(key) {
      const found = objects.get(key);
      if (!found) throw new Error(`missing ${key}`);
      return found;
    },
    async stream(key) {
      const found = objects.get(key);
      if (!found) throw new Error(`missing ${key}`);
      // Small chunks, so an entry spans several pushes the way a real file does.
      return Readable.from(
        (function* () {
          for (let offset = 0; offset < found.length; offset += 7) {
            yield found.subarray(offset, offset + 7);
          }
        })(),
      );
    },
    async exists(key) {
      return objects.has(key);
    },
    async delete(key) {
      objects.delete(key);
    },
    url: () => null,
  };
}

const asset = (id: string, key: string): NonNullable<SpaceExport['assets']>[number] => ({
  id,
  driver: 'local',
  key,
  filename: key.split('/').pop() as string,
  name: key,
  mimeType: 'image/png',
  size: 3,
  width: null,
  height: null,
  duration: null,
  checksum: null,
  alt: null,
  title: null,
  meta: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  publishAt: null,
  unpublishAt: null,
});

const payload: SpaceExport = {
  manabloxSpaceExport: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  sections: ['assets'],
  space: {
    id: ids.space,
    name: 'Site',
    machineName: 'site',
    description: null,
    url: 'https://example.com',
    defaultLocale: 'en',
    locales: ['en'],
    settings: {},
  },
  assets: [
    asset('a', 'site/2026/01/one.png'),
    asset('b', 'site/2026/01/two.png'),
    asset('c', 'site/gone.png'),
  ],
};

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe('transfer archive', () => {
  it('round-trips the manifest and every file the bucket still holds', async () => {
    const source = memoryStorage({
      'site/2026/01/one.png': Buffer.from('one-png-bytes-that-span-chunks'),
      'site/2026/01/two.png': Buffer.from('two'),
    });
    const { stream, files } = writeArchive(payload, source);
    const archive = await collect(stream);
    expect(await files).toBe(2);

    const manifest = await readManifest(Readable.from([archive]));
    expect(manifest.space.machineName).toBe('site');
    expect(manifest.archive).toEqual({ files: 2 });
    expect(manifest.assets).toHaveLength(3);

    const target = memoryStorage();
    const wanted = new Map((manifest.assets ?? []).map((a) => [a.key, a.mimeType]));
    const stored = await extractFiles(Readable.from(chunked(archive, 5)), wanted, target);
    expect(stored).toBe(2);
    expect(target.objects.get('site/2026/01/one.png')?.toString()).toBe(
      'one-png-bytes-that-span-chunks',
    );
    expect(target.objects.get('site/2026/01/two.png')?.toString()).toBe('two');
  });

  it('stores only files the manifest accounts for', async () => {
    const source = memoryStorage({ 'site/2026/01/one.png': Buffer.from('one') });
    const archive = await collect(writeArchive(payload, source).stream);
    const target = memoryStorage();
    const stored = await extractFiles(Readable.from([archive]), new Map(), target);
    expect(stored).toBe(0);
    expect(target.objects.size).toBe(0);
  });

  it('refuses an entry that inflates past its ceiling', async () => {
    // A megabyte of zeroes deflates to a few kilobytes; the limit applies to inflated bytes.
    const { zipSync } = await import('fflate');
    const bomb = Buffer.from(
      zipSync({ 'files/site/2026/01/one.png': new Uint8Array(1024 * 1024) }, { level: 9, mem: 12 }),
    );
    expect(bomb.length).toBeLessThan(64 * 1024);

    const target = memoryStorage();
    const wanted = new Map([['site/2026/01/one.png', 'image/png']]);
    await expect(
      extractFiles(Readable.from([bomb]), wanted, target, {
        maxEntryBytes: 4096,
        maxTotalBytes: 1024 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ key: 'space.import.tooLarge' });
    expect(target.objects.size).toBe(0);
  });

  it('refuses an archive whose entries together inflate past the total', async () => {
    const { zipSync } = await import('fflate');
    const bomb = Buffer.from(
      zipSync(
        {
          'files/site/2026/01/one.png': new Uint8Array(64 * 1024),
          'files/site/2026/01/two.png': new Uint8Array(64 * 1024),
        },
        { level: 9, mem: 12 },
      ),
    );
    const target = memoryStorage();
    const wanted = new Map([
      ['site/2026/01/one.png', 'image/png'],
      ['site/2026/01/two.png', 'image/png'],
    ]);
    await expect(
      extractFiles(Readable.from([bomb]), wanted, target, {
        // Either entry fits on its own; together they do not.
        maxEntryBytes: 1024 * 1024,
        maxTotalBytes: 96 * 1024,
      }),
    ).rejects.toMatchObject({ key: 'space.import.tooLarge' });
  });

  it('writes the manifest compactly, so a large space stays under the ceiling', async () => {
    // Indentation could push a large manifest past the `readManifest` limit.
    const source = memoryStorage({ 'site/2026/01/one.png': Buffer.from('one') });
    const archive = await collect(writeArchive(payload, source).stream);

    const { unzipSync, strFromU8 } = await import('fflate');
    const entry = unzipSync(new Uint8Array(archive))['space.json'] as Uint8Array;
    const text = strFromU8(entry);
    expect(text).not.toContain('\n');
    expect(text).toBe(JSON.stringify(JSON.parse(text)));
  });

  it('refuses an archive without a manifest', async () => {
    const { zipSync } = await import('fflate');
    const stray = Buffer.from(zipSync({ 'readme.txt': new TextEncoder().encode('hi') }));
    await expect(readManifest(Readable.from([stray]))).rejects.toMatchObject({
      key: 'space.import.notAnExport',
    });
  });
});

function* chunked(buffer: Buffer, size: number): Generator<Buffer> {
  for (let offset = 0; offset < buffer.length; offset += size) {
    yield buffer.subarray(offset, offset + size);
  }
}
