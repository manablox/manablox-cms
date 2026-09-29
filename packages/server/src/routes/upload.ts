import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { Busboy } from '@fastify/busboy';
import { assertCan } from '@manablox/auth';
import { ManabloxError, rateLimitExceeded } from '@manablox/core';
import type { AssetRow } from '@manablox/db';
import { type StagedUpload, stageUpload } from '@manablox/media';
import { Hono, type MiddlewareHandler } from 'hono';
import type { Runtime } from '../bootstrap.js';
import { principal, principalOf } from '../middleware/principal.js';

/** Room for the multipart boundaries, part headers and the text fields. */
const ENVELOPE_BYTES = 1024 * 1024;

/**
 * Authenticated multipart upload of one file. The file streams to a temp file and is refused
 * once past the space's size limit; the bytes are sniffed before the declared type is accepted.
 */
export function uploadRoutes(runtime: Runtime): Hono {
  const app = new Hono();

  app.post('/upload/:spaceId', principal(runtime), uploadRateLimits(runtime), async (c) => {
    const spaceId = c.req.param('spaceId');
    const caller = principalOf(c);
    assertCan(caller, spaceId, 'asset:write');

    const space = await runtime.repos.spaces.findById(spaceId);
    if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });
    await runtime.spaces.assertWritable(spaceId);
    await runtime.manablox.controls.assertWritable(spaceId);
    await runtime.manablox.controls.assertUsage(spaceId, 'uploads');

    const rules = await runtime.media.effectiveUploadRules(spaceId);
    // Refused before a byte is read when the declared body cannot fit.
    const length = Number(c.req.header('content-length'));
    if (length > rules.maxFileSize + ENVELOPE_BYTES) {
      throw ManabloxError.tooLarge('asset.tooLarge', { size: length, max: rules.maxFileSize });
    }

    const form = await readUpload(c.req.raw, rules.maxFileSize);
    let asset: AssetRow;
    try {
      asset = await runtime.media.upload({
        spaceId,
        filename: form.filename,
        mimeType: form.mimeType || 'application/octet-stream',
        body: form.file,
        ...(form.fields.alt !== undefined ? { alt: form.fields.alt } : {}),
        ...(form.fields.title !== undefined ? { title: form.fields.title } : {}),
        actorId: caller?.userId ?? null,
      });
    } finally {
      await form.file.discard();
    }

    runtime.manablox.controls.consume(spaceId, 'uploads', 1);
    await runtime.manablox.hooks.run(
      'asset:afterUpload',
      { id: asset.id },
      { manablox: runtime.manablox, spaceId },
    );

    return c.json(runtime.media.present(asset), 201);
  });

  return app;
}

/** Longest an upload holds a `uploads.parallel` slot. */
const UPLOAD_SLOT_MS = 10 * 60_000;

/** `uploads` per space and `uploads.parallel`, counted only for callers who may upload. */
function uploadRateLimits(runtime: Runtime): MiddlewareHandler {
  return async (c, next) => {
    const spaceId = c.req.param('spaceId') ?? '';
    assertCan(principalOf(c), spaceId, 'asset:write');
    const { controls } = runtime.manablox;
    await controls.assertRate(spaceId, [{ rule: 'uploads', key: spaceId }]);
    const slot = await controls.acquire(spaceId, 'uploads.parallel', UPLOAD_SLOT_MS);
    if (!slot) throw rateLimitExceeded('uploads.parallel', 5);
    try {
      await next();
    } finally {
      await slot.release();
    }
  };
}

interface ParsedUpload {
  file: StagedUpload;
  filename: string;
  mimeType: string;
  fields: { alt?: string; title?: string };
}

/** Streams the `file` part to a temp file and collects `alt` and `title`. */
function readUpload(request: Request, maxFileSize: number): Promise<ParsedUpload> {
  const type = request.headers.get('content-type') ?? '';
  if (!request.body || !type.toLowerCase().startsWith('multipart/form-data')) {
    throw ManabloxError.badRequest('asset.file.required');
  }
  const body = Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>);
  let parser: InstanceType<typeof Busboy>;
  try {
    parser = new Busboy({
      headers: { 'content-type': type },
      limits: { files: 1, fields: 8, fieldSize: 64 * 1024, parts: 9 },
    });
  } catch {
    throw ManabloxError.badRequest('asset.file.required');
  }

  return new Promise((resolve, reject) => {
    const fields: ParsedUpload['fields'] = {};
    let staged: Promise<StagedUpload> | null = null;
    let meta = { filename: '', mimeType: '' };
    let failed = false;

    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      body.unpipe(parser);
      body.destroy();
      // A file staged meanwhile is not handed over.
      staged?.then((file) => file.discard()).catch(() => {});
      reject(error);
    };

    parser.on('file', (name, stream, filename, _encoding, mimeType) => {
      if (name !== 'file') {
        stream.resume();
        return;
      }
      meta = { filename, mimeType };
      staged = stageUpload(stream, maxFileSize);
      staged.catch(fail);
    });
    parser.on('field', (name, value) => {
      if (name === 'alt' || name === 'title') fields[name] = value;
    });
    parser.on('filesLimit', () => fail(ManabloxError.badRequest('asset.file.single')));
    parser.on('error', fail);
    parser.on('finish', () => {
      if (!staged) {
        fail(ManabloxError.badRequest('asset.file.required'));
        return;
      }
      staged.then((file) => {
        if (failed) return;
        resolve({ file, ...meta, fields });
      }, fail);
    });
    body.on('error', fail);
    body.pipe(parser);
  });
}
