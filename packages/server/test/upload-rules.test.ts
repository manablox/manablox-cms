import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { serve } from '@hono/node-server';
import { TOTAL_PERIOD } from '@manablox/db';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrap, type ManagementRuntime, requireManagement } from '../src/bootstrap.js';

const KEY = 'upload-rules-key-0123456789';
const MB = 1024 * 1024;
const BOUNDARY = 'manablox-test-boundary';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let app: Hono;
let spaceId: string;
let apiKey: string;

const json = async (response: Response) => (await response.json()) as Record<string, any>;

const control = (path: string, init: { method?: string; body?: unknown } = {}) =>
  app.request(`/control/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

/** Sets upload controls at `scope`, runs `run`, then removes them. */
async function withControls(
  scope: string,
  values: Record<string, unknown>,
  run: () => Promise<void>,
): Promise<void> {
  expect(
    (await control(`/settings?scope=${scope}`, { method: 'PATCH', body: values })).status,
  ).toBe(200);
  api.controlStore.forget(null);
  try {
    await run();
  } finally {
    for (const key of Object.keys(values)) {
      await control(`/settings/${key}?scope=${scope}`, { method: 'DELETE' });
    }
    api.controlStore.forget(null);
  }
}

/** A solid RGB PNG, `width` x 20. */
async function png(width = 40, shade = 0xc0): Promise<Buffer> {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(20, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, shade)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: 20 }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Sends the form as bytes. undici streams a FormData body from a task nobody awaits, and a
 * route that stops reading early (a second file) closes the stream under it: its next
 * enqueue throws as an unhandled rejection, which fails the run.
 */
const upload = async (form: FormData) => {
  const encoded = new Response(form);
  return app.request(`/upload/${spaceId}`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'content-type': encoded.headers.get('content-type') ?? '',
    },
    body: await encoded.arrayBuffer(),
  });
};

const formWith = (...files: Array<[Buffer, string, string?]>) => {
  const form = new FormData();
  for (const [bytes, name, type] of files) {
    form.append('file', new File([new Uint8Array(bytes)], name, { type: type ?? 'image/png' }));
  }
  return form;
};

/**
 * A multipart body of one generated file of `size` bytes, produced as it is read; `pulled`
 * counts the bytes handed out.
 */
function streamedForm(size: number) {
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n',
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
  const chunk = new Uint8Array(256 * 1024).fill(9);
  const state = { pulled: 0, sent: 0, peakExternal: 0 };
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controller.enqueue(head);
        state.pulled += head.length;
      },
      pull(controller) {
        if (state.sent >= size) {
          controller.enqueue(tail);
          controller.close();
          return;
        }
        const piece = chunk.subarray(0, Math.min(chunk.length, size - state.sent));
        state.sent += piece.length;
        state.pulled += piece.length;
        if (state.sent % (8 * MB) === 0) {
          state.peakExternal = Math.max(state.peakExternal, process.memoryUsage().arrayBuffers);
        }
        controller.enqueue(piece);
      },
    },
    { highWaterMark: 0 },
  );
  const request = (headers: Record<string, string> = {}) =>
    app.request(`/upload/${spaceId}`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        ...headers,
      },
      body,
      duplex: 'half',
    } as RequestInit);
  return { request, state };
}

beforeAll(async () => {
  db = await createTestDatabase('server_upload_rules');
  dir = await mkdtemp(join(tmpdir(), 'manablox-upload-rules-'));

  api = requireManagement(
    await bootstrap({
      database: { url: db.url },
      auth: { secret: 'upload-rules-secret' },
      fieldTypes: builtinFieldTypes,
      contentTypes: [],
      logLevel: 'silent',
      storage: {
        driver: 'local',
        local: { path: join(dir, 'files') },
        maxFileSize: 100 * MB,
        allowedMimeTypes: ['image/', 'application/pdf', 'application/octet-stream'],
      },
      server: { rateLimit: false, scopes: ['rpc', 'auth', 'uploads', 'media', 'control'] },
      control: { apiKey: KEY },
    }),
  );
  app = await createApp(api);

  const admin = await api.repos.users.create({
    name: 'Admin',
    email: 'admin@uploads.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  apiKey = (await api.apiKeys.issue(admin.id, 'uploads')).key;
  const space = await api.repos.spaces.create({
    name: 'uploads',
    machineName: 'uploads',
    url: 'https://uploads.test',
    defaultLocale: 'en',
    locales: ['en'],
  });
  spaceId = space.id;
}, 60_000);

afterAll(async () => {
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('the upload route', () => {
  it('stores a file with its alt text and title, keeping a UTF-8 name', async () => {
    const form = formWith([await png(41), 'grün.png', 'application/octet-stream']);
    form.set('alt', 'A red square');
    form.set('title', 'Red');
    const response = await upload(form);
    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({
      name: 'grün',
      mimeType: 'image/png',
      alt: 'A red square',
      title: 'Red',
      width: 41,
      height: 20,
    });
  });

  it('takes several files as parallel requests, with their variants; a repeat is deduped', async () => {
    const [a, b] = await Promise.all([png(42), png(43)]);
    const responses = await Promise.all([
      upload(formWith([a, 'a.png'])),
      upload(formWith([b, 'b.png'])),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const [first, second] = await Promise.all(responses.map(json));
    expect(first?.id).not.toBe(second?.id);
    expect(await api.repos.assets.findVariant(first?.id, 'thumb', 'webp')).not.toBeNull();
    expect(await api.repos.assets.findVariant(second?.id, 'thumb', 'webp')).not.toBeNull();

    const copy = await upload(formWith([a, 'a-copy.png']));
    expect((await json(copy)).id).toBe(first?.id);
  });

  it('stores two concurrent identical uploads once, counting their bytes once', async () => {
    const space = await api.repos.spaces.create({
      name: 'dedupe',
      machineName: 'dedupe',
      url: 'https://dedupe.test',
    });
    const bytes = await png(44);
    const put = (filename: string) =>
      api.media.upload({ spaceId: space.id, filename, mimeType: 'image/png', body: bytes });
    const [first, second] = await Promise.all([put('one.png'), put('two.png')]);
    expect(second.id).toBe(first.id);
    const page = await api.repos.assets.page({ spaceId: space.id }, { limit: 10, offset: 0 });
    expect(page.items).toHaveLength(1);
    const variants = await api.repos.assets.listVariantsByAssets([first.id]);
    const stored = await api.repos.usageCounters.get({
      scope: { kind: 'space', id: space.id },
      metric: 'storageBytes',
      period: TOTAL_PERIOD,
    });
    expect(stored).toBe(first.size + variants.reduce((sum, variant) => sum + variant.size, 0));
  });

  it('refuses a request with no file or with two', async () => {
    const empty = new FormData();
    empty.set('alt', 'nothing');
    const none = await upload(empty);
    expect(none.status).toBe(400);
    expect((await json(none)).error.key).toBe('asset.file.required');

    const two = await upload(formWith([await png(44), 'a.png'], [await png(45), 'b.png']));
    expect(two.status).toBe(400);
    expect((await json(two)).error.key).toBe('asset.file.single');
  });

  it('refuses a declared Content-Length past the limit before reading the body', async () => {
    const { request, state } = streamedForm(10 * MB);
    await withControls(`space:${spaceId}`, { 'uploads.maxFileSize': MB }, async () => {
      const response = await request({ 'content-length': String(10 * MB + 200) });
      expect(response.status).toBe(413);
      expect((await json(response)).error).toMatchObject({
        key: 'asset.tooLarge',
        kind: 'too_large',
        details: [{ params: { max: MB } }],
      });
    });
    expect(state.sent).toBe(0);
  });

  it('aborts a streamed file once past the limit, without reading the rest', async () => {
    const { request, state } = streamedForm(100 * MB);
    await withControls('instance', { 'uploads.maxFileSize': 2 * MB }, async () => {
      const response = await request();
      expect(response.status).toBe(413);
      expect((await json(response)).error.key).toBe('asset.tooLarge');
    });
    expect(state.pulled).toBeLessThan(8 * MB);
  });

  it('answers 413 over a real socket while the client is still sending', async () => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await withControls('instance', { 'uploads.maxFileSize': 2 * MB }, async () => {
        const answer = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          const outgoing = httpRequest({
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: `/upload/${spaceId}`,
            headers: {
              'x-api-key': apiKey,
              'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
            },
          });
          outgoing.on('response', (response) => {
            let body = '';
            response.on('data', (chunk) => {
              body += chunk;
            });
            response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
          });
          outgoing.on('error', reject);
          outgoing.write(
            `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\n\r\n`,
          );
          const chunk = Buffer.alloc(256 * 1024, 9);
          let sent = 0;
          const pump = () => {
            while (sent < 100 * MB && !outgoing.destroyed) {
              sent += chunk.length;
              if (!outgoing.write(chunk)) {
                outgoing.once('drain', pump);
                return;
              }
            }
            outgoing.end();
          };
          pump();
        });
        expect(answer.status).toBe(413);
        expect(JSON.parse(answer.body).error.key).toBe('asset.tooLarge');
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('streams a large allowed file to storage without buffering it', async () => {
    const baseline = process.memoryUsage().arrayBuffers;
    const { request, state } = streamedForm(50 * MB);
    const response = await request();
    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({
      size: 50 * MB,
      mimeType: 'application/octet-stream',
    });
    expect(state.peakExternal - baseline).toBeLessThan(24 * MB);
  });

  it('refuses a type the controls leave out', async () => {
    await withControls(
      `space:${spaceId}`,
      { 'uploads.allowedMimeTypes': ['application/pdf'] },
      async () => {
        const response = await upload(formWith([await png(46), 'x.png']));
        expect(response.status).toBe(400);
        expect((await json(response)).error.key).toBe('asset.mimeType.notAllowed');
      },
    );
  });
});

describe('space asset settings', () => {
  it('shows the control bounds and refuses values past them, naming the bound', async () => {
    await withControls(
      'instance',
      { 'uploads.maxFileSize': 5 * MB, 'uploads.allowedMimeTypes': ['image/'] },
      async () => {
        const limits = await api.media.limits(spaceId);
        expect(limits.controls).toEqual({ maxFileSize: 5 * MB, allowedMimeTypes: ['image/'] });
        expect(limits.ceiling).toEqual({ maxFileSize: 5 * MB, allowedMimeTypes: ['image/'] });
        expect(limits.instance.maxFileSize).toBe(100 * MB);

        await expect(
          api.spaces.setAssetSettings(spaceId, {
            maxFileSize: 6 * MB,
            allowedMimeTypes: ['image/png', 'application/pdf', 'video/'],
          }),
        ).rejects.toMatchObject({
          key: 'space.validation.failed',
          details: [
            {
              key: 'space.assets.mimeType.outsideControl',
              path: ['allowedMimeTypes', 1],
              params: { mimeType: 'application/pdf' },
            },
            { key: 'space.assets.mimeType.outsideInstance', path: ['allowedMimeTypes', 2] },
            { key: 'space.assets.maxFileSize.aboveControl', params: { max: 5 * MB } },
          ],
        });
        await expect(
          api.spaces.setAssetSettings(spaceId, { maxFileSize: 200 * MB }),
        ).rejects.toMatchObject({
          details: [{ key: 'space.assets.maxFileSize.aboveInstance', params: { max: 100 * MB } }],
        });

        await api.spaces.setAssetSettings(spaceId, {
          maxFileSize: 4 * MB,
          allowedMimeTypes: ['image/png'],
        });
        expect(await api.media.effectiveUploadRules(spaceId)).toEqual({
          maxFileSize: 4 * MB,
          allowedMimeTypes: ['image/png'],
        });
        await api.spaces.setAssetSettings(spaceId, {});
      },
    );
  });
});

describe('other entry points', () => {
  it('refuses an import whose files the instance rules refuse', async () => {
    const exported = await app.request(`/transfer/${spaceId}/export`, {
      headers: { 'x-api-key': apiKey },
    });
    expect(exported.status).toBe(200);
    const archive = Buffer.from(await exported.arrayBuffer());
    await api.spaces.delete(spaceId);

    await withControls('instance', { 'uploads.maxFileSize': 20 * MB }, async () => {
      const response = await app.request('/transfer/import', {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: archive,
      });
      expect(response.status).toBe(422);
      const error = (await json(response)).error;
      expect(error.key).toBe('space.import.assetsRefused');
      expect(error.details).toEqual([
        expect.objectContaining({
          key: 'asset.tooLarge',
          params: expect.objectContaining({
            filename: expect.stringMatching(/^big.*\.bin$/),
            size: 50 * MB,
            max: 20 * MB,
          }),
        }),
      ]);
    });
  });
});
