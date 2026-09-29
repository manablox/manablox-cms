import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { Context } from 'hono';
import { matchesEtag } from '../middleware/delivery-cache.js';

/** The content codings the admin files come in, in order of preference. */
type Encoding = 'br' | 'gzip';
const ENCODINGS: readonly Encoding[] = ['br', 'gzip'];
/** Where the admin build puts a file's precompressed copies. */
const SUFFIX: Record<Encoding, string> = { br: '.br', gzip: '.gz' };

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** Text types worth compressing; fonts and images already are. */
const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.webmanifest',
  '.txt',
  '.svg',
]);
/** Below this a compressed body saves less than its headers cost. */
const MIN_COMPRESS_BYTES = 1024;

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** A file the admin routes answer with, in each coding it has. */
export interface ServedFile {
  type: string;
  /** Opaque validator of the identity body, unquoted; codings get their own suffix. */
  etag: string;
  encodings(): Promise<readonly Encoding[]>;
  body(encoding: Encoding | null): Promise<Buffer>;
}

/** The coding to answer `accept-encoding` with, brotli first; null for the identity body. */
export function negotiateEncoding(
  header: string | undefined,
  available: readonly Encoding[],
): Encoding | null {
  if (!header || available.length === 0) return null;
  const weights = new Map<string, number>();
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const q = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
    const weight = q === undefined ? 1 : Number(q.slice(2));
    weights.set(name, Number.isFinite(weight) ? weight : 0);
  }
  const weightOf = (encoding: Encoding) =>
    weights.get(encoding) ??
    (encoding === 'gzip' ? weights.get('x-gzip') : undefined) ??
    weights.get('*') ??
    0;
  let best: Encoding | null = null;
  for (const encoding of ENCODINGS) {
    if (!available.includes(encoding)) continue;
    if (weightOf(encoding) > (best ? weightOf(best) : 0)) best = encoding;
  }
  return best;
}

/**
 * Answers with `file` in the coding the client prefers: `content-encoding`, `content-length`,
 * `vary` and a per-coding ETag, or 304 when the client holds that one.
 */
export async function sendFile(c: Context, file: ServedFile, cacheControl: string) {
  const available = await file.encodings();
  const encoding = negotiateEncoding(c.req.header('accept-encoding'), available);
  const etag = `"${file.etag}${encoding ? `-${encoding}` : ''}"`;
  const headers: Record<string, string> = { 'cache-control': cacheControl, etag };
  if (available.length > 0) headers.vary = 'accept-encoding';
  if (matchesEtag(c.req.header('if-none-match'), etag)) return c.body(null, 304, headers);

  const body = await file.body(encoding);
  headers['content-type'] = contentType(file.type);
  headers['content-length'] = String(body.length);
  if (encoding) headers['content-encoding'] = encoding;
  return c.body(new Uint8Array(body), 200, headers);
}

function contentType(nameOrType: string): string {
  return nameOrType.includes('/') ? nameOrType : (TYPES[nameOrType] ?? 'application/octet-stream');
}

/**
 * A file on disk with the `.br` / `.gz` copies the admin build writes next to it. Read per
 * request; its size and mtime make the ETag.
 */
export async function diskFile(path: string): Promise<ServedFile | null> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return null;
  const encodings: Encoding[] = [];
  for (const encoding of ENCODINGS) {
    const copy = await stat(path + SUFFIX[encoding]).catch(() => null);
    if (copy?.isFile()) encodings.push(encoding);
  }
  return {
    type: extname(path),
    etag: `${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}`,
    encodings: async () => encodings,
    body: (encoding) => readFile(encoding ? path + SUFFIX[encoding] : path),
  };
}

/** A file read from disk per request, uncompressed; `etag` comes from the caller. */
export function unkeptFile(path: string, etag: string): ServedFile {
  return { type: extname(path), etag, encodings: async () => [], body: () => readFile(path) };
}

/**
 * A body held in memory, compressed on its first request (brotli 11 and gzip 9, off the
 * event loop) and kept; a coding that does not come out smaller is left out.
 */
export function memoryFile(name: string, bytes: Buffer, etag: string): ServedFile {
  const type = extname(name);
  let compressed: Promise<Map<Encoding, Buffer>> | null = null;
  const variants = () => {
    compressed ??=
      COMPRESSIBLE.has(type) && bytes.length >= MIN_COMPRESS_BYTES
        ? compress(bytes)
        : Promise.resolve(new Map());
    return compressed;
  };
  return {
    type,
    etag,
    encodings: async () => [...(await variants()).keys()],
    body: async (encoding) => (encoding ? ((await variants()).get(encoding) ?? bytes) : bytes),
  };
}

async function compress(bytes: Buffer): Promise<Map<Encoding, Buffer>> {
  const variants = new Map<Encoding, Buffer>();
  try {
    const [br, gz] = await Promise.all([
      brotli(bytes, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
          [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
        },
      }),
      gzipAsync(bytes, { level: 9 }),
    ]);
    if (br.length < bytes.length) variants.set('br', br);
    if (gz.length < bytes.length) variants.set('gzip', gz);
  } catch {
    // Served uncompressed then.
  }
  return variants;
}
