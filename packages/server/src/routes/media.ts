import type { Readable } from 'node:stream';
import { ManabloxError } from '@manablox/core';
import type { AssetRow } from '@manablox/db';
import { assetMaxAge, IMMUTABLE_MAX_AGE, isAvailable } from '@manablox/media';
import { type Context, Hono } from 'hono';
import type { Runtime } from '../bootstrap.js';
import { errorResponse, notFoundResponse } from '../errors.js';
import { matchesEtag } from '../middleware/delivery-cache.js';
import { served } from '../middleware/served.js';
import { usageRefusal } from '../middleware/usage-gate.js';

declare module 'hono' {
  interface ContextVariableMap {
    /** The space a media request was served within, when it names one. */
    mediaSpaceId?: string | null;
    /** The asset a media request served. */
    mediaAssetId?: string;
  }
}

export interface MediaRouteOptions {
  /** Restricts lookups to one space (public instance). */
  spaceId?: string | null;
  /** Requires the asset to be used by a published document and inside its availability window. */
  publishedOnly?: boolean;
  /** Per request, for a multi-space instance: the space it may read; `null` answers 404. */
  scope?: (c: Context) => Promise<MediaScope | null>;
}

export interface MediaScope {
  spaceId: string;
  /** A staging environment whose published documents make an asset public too. */
  stagingId?: string | null | undefined;
  /**
   * Lets an asset through that no published document uses: `true` for public use (a design's
   * font), `'private'` for one only this request may see (a share preview's draft asset).
   */
  allows?: (asset: AssetRow) => Promise<boolean | 'private'>;
  /** Every answer stays out of shared caches, e.g. on a password-protected site. */
  private?: boolean | undefined;
}

/** Serves originals and derivatives; variants are generated on first request and cached in storage. */
export function mediaRoutes(runtime: Runtime, options: MediaRouteOptions = {}): Hono {
  const app = new Hono();
  const spaceId = options.spaceId ?? null;

  /** Applies the public-instance restrictions; `private` answers must stay out of shared caches. */
  const findAsset = async (
    c: Context,
    assetId: string,
  ): Promise<{ asset: AssetRow; private: boolean } | null> => {
    const scope = options.scope ? await options.scope(c) : undefined;
    if (scope === null) return null;
    // Staging answers stay out of shared caches, so an unpublish there takes effect.
    const shared = scope?.private !== true && !scope?.stagingId;
    const within = scope?.spaceId ?? spaceId;
    c.set('mediaSpaceId', within);
    // A space is hidden until its import finished.
    if (within && !(await runtime.spaces.isReady(within))) return null;
    const asset = await runtime.repos.assets.findById(assetId, within);
    if (!asset) return null;
    c.set('mediaAssetId', asset.id);
    if (options.publishedOnly) {
      // Checked per request; assets have no published state of their own.
      if (!isAvailable(asset)) return null;
      const reachable = await runtime.repos.assetUsages.filterPublished(
        [asset.id],
        scope?.stagingId,
      );
      if (!reachable.has(asset.id)) {
        const allowed = (await scope?.allows?.(asset)) ?? false;
        if (!allowed) return null;
        return { asset, private: allowed === 'private' || !shared };
      }
    }
    return { asset, private: !shared };
  };

  /** Media within a space whose bandwidth is used up is refused. */
  const bandwidthRefusal = (c: Context) =>
    usageRefusal(c, runtime.manablox, c.get('mediaSpaceId'), ['bandwidthBytes']);

  app.use(
    '/media/*',
    served(runtime.manablox, {
      surface: () => 'media',
      // Without a space in the request, the asset's owning space.
      spaceId: async (c) => {
        const within = c.get('mediaSpaceId') ?? spaceId;
        if (within) return within;
        const assetId = c.get('mediaAssetId');
        return assetId ? runtime.media.owningSpace(assetId) : null;
      },
    }),
  );

  app.get('/media/:assetId/original', async (c) => {
    const assetId = c.req.param('assetId');
    const found = await findAsset(c, assetId);
    if (!found)
      return notFoundResponse(c, ManabloxError.notFound('asset.notFound', { id: assetId }));
    const refused = await bandwidthRefusal(c);
    if (refused) return refused;
    const { asset } = found;

    return original(c, runtime, asset, cacheControl(found));
  });

  app.get('/media/:assetId/:variant', async (c) => {
    const assetId = c.req.param('assetId');
    const variant = c.req.param('variant');

    const dot = variant.lastIndexOf('.');
    const preset = dot > 0 ? variant.slice(0, dot) : variant;
    const format = dot > 0 ? variant.slice(dot + 1) : 'webp';

    // Unsigned transforms would allow resize amplification.
    if (!runtime.media.verify(assetId, preset, format, c.req.query('s'))) {
      return errorResponse(c, ManabloxError.forbidden('media.signature.invalid'));
    }

    const found = await findAsset(c, assetId);
    if (!found)
      return notFoundResponse(c, ManabloxError.notFound('asset.notFound', { id: assetId }));
    const refused = await bandwidthRefusal(c);
    if (refused) return refused;
    const { asset } = found;

    const { body, contentType } = await runtime.media.derive(asset, preset, format);

    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': contentType,
        'content-length': String(body.byteLength),
        'cache-control': cacheControl(found),
      },
    });
  });

  return app;
}

/** A single `bytes=` range of an object of `size` bytes; `null` for none, `'invalid'` past it. */
function byteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | 'invalid' {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  // Several ranges or another unit: the whole object, which a client must accept.
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || end < start) return 'invalid';
  return { start, end };
}

/**
 * An original, streamed from storage: never held in memory, `Range` answered with 206, and
 * an ETag from the upload's checksum for conditional requests.
 */
async function original(
  c: Context,
  runtime: Runtime,
  asset: AssetRow,
  cacheControl: string,
): Promise<Response> {
  const etag = asset.checksum ? `"${asset.checksum}"` : null;
  const headers: Record<string, string> = {
    'content-type': asset.mimeType,
    'cache-control': cacheControl,
    'content-disposition': `inline; filename="${encodeURIComponent(asset.filename)}"`,
    'accept-ranges': 'bytes',
    ...(etag ? { etag } : {}),
  };
  if (etag && matchesEtag(c.req.header('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: { etag, 'cache-control': cacheControl } });
  }
  const size = asset.size;
  // A range applies only while the client's copy is the current one.
  const ifRange = c.req.header('if-range');
  const range =
    ifRange === undefined || (etag !== null && ifRange.trim() === etag)
      ? byteRange(c.req.header('range'), size)
      : null;
  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: { 'content-range': `bytes */${size}`, 'cache-control': cacheControl },
    });
  }
  const stream = await runtime.storage.stream(asset.key, range ?? undefined);
  const body = await startedStream(stream);
  if (!range) {
    return new Response(body, { headers: { ...headers, 'content-length': String(size) } });
  }
  return new Response(body, {
    status: 206,
    headers: {
      ...headers,
      'content-length': String(range.end - range.start + 1),
      'content-range': `bytes ${range.start}-${range.end}/${size}`,
    },
  });
}

/**
 * The stream as a web stream once its first chunk is read, so a missing object fails before
 * the response starts rather than cutting it off.
 */
async function startedStream(stream: Readable): Promise<ReadableStream<Uint8Array>> {
  const chunks = stream[Symbol.asyncIterator]();
  const first = await chunks.next();
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        if (first.done) controller.close();
        else controller.enqueue(bytesOf(first.value));
      },
      async pull(controller) {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(bytesOf(next.value));
      },
      async cancel() {
        stream.destroy();
      },
    },
    { highWaterMark: 0 },
  );
}

/** A chunk as bytes, without copying a Buffer. */
function bytesOf(chunk: unknown): Uint8Array {
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  const view = chunk as Uint8Array;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** Immutable for a year, unless a scheduled takedown needs a shorter max-age or it is private. */
function cacheControl({ asset, private: only }: { asset: AssetRow; private: boolean }): string {
  if (only) return 'private, no-store';
  const maxAge = assetMaxAge(asset);
  return maxAge >= IMMUTABLE_MAX_AGE
    ? `public, max-age=${IMMUTABLE_MAX_AGE}, immutable`
    : `public, max-age=${maxAge}`;
}
