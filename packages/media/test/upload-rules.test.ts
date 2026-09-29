import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ResolvedUploadRules } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { AssetRow, Repositories } from '@manablox/db';
import { LocalStorageDriver } from '@manablox/storage';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MediaService } from '../src/service.js';
import { stageUpload } from '../src/stage.js';

const SPACE = 's1';
const MB = 1024 * 1024;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'manablox-upload-rules-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A service over local storage in a temp dir and in-memory asset rows. */
function service(
  options: {
    controls?: Partial<ResolvedUploadRules>;
    space?: Record<string, unknown>;
    maxFileSize?: number;
    allowedMimeTypes?: string[];
  } = {},
) {
  const rows = new Map<string, AssetRow>();
  const variants = new Map<string, { key: string }>();
  const manablox = {
    hooks: { run: async (_name: string, payload: unknown) => payload },
    controls: {
      assertLimit: async () => [],
      resolved: async () => ({
        uploads: { maxFileSize: null, allowedMimeTypes: null, ...options.controls },
      }),
    },
    logger: { warn: vi.fn(), debug: vi.fn() },
  } as unknown as Manablox;
  const storage = new LocalStorageDriver({
    path: join(dir, `files-${rows.size}-${Math.random()}`),
  });
  const put = vi.spyOn(storage, 'put');
  const repos = {
    spaces: { findById: async () => ({ id: SPACE, settings: options.space ?? {} }) },
    assets: {
      findByChecksum: async (_spaceId: string, checksum: string) =>
        [...rows.values()].find((row) => row.checksum === checksum) ?? null,
      create: async (data: Partial<AssetRow>) => {
        const row = { id: `a${rows.size + 1}`, meta: {}, updatedAt: new Date(), ...data };
        rows.set(row.id, row as AssetRow);
        return row as AssetRow;
      },
      findById: async (id: string) => rows.get(id) ?? null,
      findVariant: async (assetId: string, preset: string, format: string) =>
        variants.get(`${assetId}/${preset}/${format}`) ?? null,
      upsertVariant: async (v: {
        assetId: string;
        preset: string;
        format: string;
        key: string;
      }) => {
        variants.set(`${v.assetId}/${v.preset}/${v.format}`, { key: v.key });
      },
    },
    audit: { record: async () => undefined },
    locks: { withLock: <T>(_name: string, fn: () => Promise<T>) => fn() },
  } as unknown as Repositories;
  const media = new MediaService(
    repos,
    storage,
    {
      cachePath: join(dir, 'cache'),
      presets: { thumb: { width: 10, fit: 'inside' } },
      eager: ['thumb'],
    },
    {
      maxFileSize: options.maxFileSize ?? 100 * MB,
      allowedMimeTypes: options.allowedMimeTypes ?? [],
      manablox,
    },
  );
  return { media, rows, variants, put };
}

const png = (width = 40) =>
  sharp({ create: { width, height: 20, channels: 3, background: '#c33' } })
    .png()
    .toBuffer();

/** `total` bytes in `chunk`-sized pieces of one reused buffer; `sent` counts what was pulled. */
function generated(total: number, chunkSize = 64 * 1024) {
  const chunk = Buffer.alloc(chunkSize, 7);
  const hash = createHash('sha256');
  const state = { sent: 0, peakExternal: 0 };
  async function* bytes() {
    while (state.sent < total) {
      const piece = chunk.subarray(0, Math.min(chunkSize, total - state.sent));
      state.sent += piece.length;
      hash.update(piece);
      if (state.sent % (4 * MB) === 0) {
        state.peakExternal = Math.max(state.peakExternal, process.memoryUsage().arrayBuffers);
      }
      yield piece;
    }
  }
  return { stream: Readable.from(bytes()), state, digest: () => hash.digest('hex') };
}

describe('effective upload rules', () => {
  it('refuse a file past the strictest size with asset.tooLarge (413)', async () => {
    const body = await png();
    const { media } = service({ controls: { maxFileSize: body.byteLength - 1 } });
    const upload = media.upload({ spaceId: SPACE, filename: 'x.png', mimeType: 'image/png', body });
    await expect(upload).rejects.toMatchObject({
      key: 'asset.tooLarge',
      status: 413,
      details: [{ params: { size: body.byteLength, max: body.byteLength - 1 } }],
    });
  });

  it('take the space setting when it is stricter than the controls', async () => {
    const { media } = service({
      controls: { maxFileSize: 5 * MB },
      space: { assets: { maxFileSize: MB } },
    });
    expect(await media.effectiveUploadRules(SPACE)).toEqual({
      maxFileSize: MB,
      allowedMimeTypes: null,
    });
    const limits = await media.limits(SPACE);
    expect(limits.ceiling.maxFileSize).toBe(5 * MB);
    expect(limits.controls).toEqual({ maxFileSize: 5 * MB, allowedMimeTypes: null });
  });

  it('refuse a type the controls leave out, whatever the env and space allow', async () => {
    const { media } = service({
      controls: { allowedMimeTypes: ['application/pdf'] },
      allowedMimeTypes: ['image/', 'application/pdf'],
      space: { assets: { allowedMimeTypes: ['image/'] } },
    });
    expect((await media.effectiveUploadRules(SPACE)).allowedMimeTypes).toEqual([]);
    await expect(
      media.upload({ spaceId: SPACE, filename: 'x.png', mimeType: 'image/png', body: await png() }),
    ).rejects.toMatchObject({ key: 'asset.mimeType.notAllowed' });
  });
});

describe('staged uploads', () => {
  it('stop reading and clean up once past the limit', async () => {
    const staging = await mkdtemp(join(dir, 'stage-'));
    const source = generated(100 * MB);
    await expect(stageUpload(source.stream, 2 * MB, staging)).rejects.toMatchObject({
      key: 'asset.tooLarge',
      status: 413,
    });
    // A few chunks of buffering past the limit, not the whole body.
    expect(source.state.sent).toBeLessThan(3 * MB);
    expect(await readdir(staging)).toEqual([]);
  });

  it('store a large file from its temp file without holding it in memory', async () => {
    const { media, put, rows } = service();
    const baseline = process.memoryUsage().arrayBuffers;
    const source = generated(50 * MB);
    const file = await stageUpload(source.stream, 100 * MB);
    try {
      expect(file.size).toBe(50 * MB);
      expect(file.checksum).toBe(source.digest());
      expect(source.state.peakExternal - baseline).toBeLessThan(16 * MB);

      const asset = await media.upload({
        spaceId: SPACE,
        filename: 'big.bin',
        mimeType: 'application/octet-stream',
        body: file,
      });
      expect(asset).toMatchObject({ size: 50 * MB, checksum: file.checksum });
      // The driver got a stream, not a buffer.
      expect(Buffer.isBuffer(put.mock.calls[0]?.[1])).toBe(false);
      expect(rows.size).toBe(1);
    } finally {
      await file.discard();
    }
  });

  it('dedupe by checksum, and probe and derive images from the temp file', async () => {
    const { media, variants, rows } = service();
    const bytes = await png();
    const first = await stageUpload(Readable.from([bytes]), MB);
    const second = await stageUpload(Readable.from([bytes]), MB);
    try {
      const asset = await media.upload({
        spaceId: SPACE,
        filename: 'photo.png',
        mimeType: 'application/octet-stream',
        body: first,
      });
      expect(asset).toMatchObject({ mimeType: 'image/png', width: 40, height: 20 });
      expect([...variants.keys()]).toEqual([`${asset.id}/thumb/webp`]);

      const again = await media.upload({
        spaceId: SPACE,
        filename: 'copy.png',
        mimeType: 'image/png',
        body: second,
      });
      expect(again.id).toBe(asset.id);
      expect(rows.size).toBe(1);
    } finally {
      await first.discard();
      await second.discard();
    }
  });
});
