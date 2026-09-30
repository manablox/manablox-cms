import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, runMigrations } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bootstrap, type Runtime, requireManagement } from '../src/bootstrap.js';

let dir: string;
let url: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'manablox-bootstrap-'));
  url = `file:${join(dir, 'db.sqlite')}`;
  const handle = await createDatabase({ url });
  await runMigrations(handle);
  await handle.close();
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Uploads a small PNG into a fresh space. */
async function uploadImage(runtime: Runtime) {
  const space = await runtime.repos.spaces.create({
    name: 'Media',
    machineName: `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    url: 'http://x',
  });
  // A 1x1 PNG.
  const body = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  return runtime.media.upload({
    spaceId: space.id,
    filename: 'photo.png',
    mimeType: 'image/png',
    body,
  });
}

const boot = (mode: 'public' | 'management', redisUrl?: string) =>
  bootstrap({
    ...(redisUrl ? { cache: { redisUrl } } : {}),
    database: { url },
    auth: { secret: 'bootstrap-test-secret' },
    fieldTypes: builtinFieldTypes,
    logLevel: 'silent',
    server: { mode },
    storage: { driver: 'local', local: { path: join(dir, 'files') } },
  });

describe('bootstrap', () => {
  it('builds no management services on a public instance', async () => {
    const runtime = await boot('public');
    try {
      expect(runtime.mode).toBe('public');
      for (const key of ['credentials', 'notifications', 'approvals']) {
        expect(key in runtime, key).toBe(false);
      }
      expect(() => requireManagement(runtime)).toThrow('publicApi.scope.managementOnly');
    } finally {
      await runtime.shutdown();
    }
  });

  it('builds them on a management instance', async () => {
    const runtime = requireManagement(await boot('management'));
    try {
      expect(runtime.credentials).toBeDefined();
      expect(runtime.approvals).toBeDefined();
    } finally {
      await runtime.shutdown();
    }
  });

  it('renders eager variants inside the upload without Redis', async () => {
    const runtime = await boot('management');
    try {
      const asset = await uploadImage(runtime);
      expect(await runtime.repos.assets.findVariant(asset.id, 'thumb', 'webp')).not.toBeNull();
    } finally {
      await runtime.shutdown();
    }
  });
});

const redisUrl = process.env.TEST_REDIS_URL ?? '';

/**
 * Every runtime shares one job queue, and test files running alongside this one boot their
 * own workers against it. On SQLite each has its own database file, so a foreign worker
 * that takes the render job fails it and the retry backoff outlasts the wait. A logical
 * database of its own keeps the job on this runtime's worker.
 */
function isolatedRedisUrl(): string {
  const url = new URL(redisUrl);
  url.pathname = '/1';
  return url.toString();
}

describe.skipIf(!redisUrl)('bootstrap over Redis', () => {
  it('returns from the upload and leaves eager variants to the worker', async () => {
    const runtime = await boot('management', isolatedRedisUrl());
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const render = runtime.media.renderVariant.bind(runtime.media);
    const spy = vi.spyOn(runtime.media, 'renderVariant').mockImplementation(async (job) => {
      await gate;
      return render(job);
    });
    try {
      const asset = await uploadImage(runtime);
      expect(await runtime.repos.assets.findVariant(asset.id, 'thumb', 'webp')).toBeNull();

      release();
      await vi.waitFor(
        async () =>
          expect(await runtime.repos.assets.findVariant(asset.id, 'thumb', 'webp')).not.toBeNull(),
        { timeout: 10_000 },
      );
      expect(spy).toHaveBeenCalledWith({ assetId: asset.id, preset: 'thumb', format: 'webp' });
    } finally {
      release();
      await runtime.shutdown();
    }
  });
});
