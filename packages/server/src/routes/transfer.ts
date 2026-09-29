import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { assertCan, type Principal } from '@manablox/auth';
import { ENVIRONMENT_HEADER, ManabloxError } from '@manablox/core';
import {
  type ImportFileSink,
  type SpaceExportSection,
  type TransferSelection,
  transferProviders,
} from '@manablox/services';
import { Hono } from 'hono';
import type { Runtime } from '../bootstrap.js';
import { principal, principalOf, requireSuperadmin } from '../middleware/principal.js';
import {
  type ArchiveSection,
  extractFiles,
  isArchiveSection,
  writeArchive,
} from '../transfer/archive.js';
import { readUploadedExport } from '../transfer/upload.js';

/**
 * Space export as a streamed download and import as an upload. Import spools to disk, stages
 * the files, then restores the records from the manifest.
 */
export function transferRoutes(runtime: Runtime): Hono {
  const app = new Hono();

  app.get('/transfer/:spaceId/export', principal(runtime), async (c) => {
    const spaceId = c.req.param('spaceId');
    const who = principalOf(c);
    assertCan(who, spaceId, 'space:export');
    // `?environment=` for plain downloads, else the header; production when absent.
    const environment = c.req.query('environment') ?? c.req.header(ENVIRONMENT_HEADER) ?? null;
    const scope = await runtime.environments.forRequest(spaceId, environment, who);

    const { sections, selection } = parseSelection(c.req.query(), sectionKinds(runtime));
    const payload = await runtime.spaces.export(scope, selection);
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = scope.production ? '' : `-${scope.machineName}`;
    const name = `${payload.space.machineName}${suffix}-${stamp}.manablox`;

    if (sections.length && !sections.includes('files')) {
      // Compact: indenting can push a large space past the import limit.
      return new Response(JSON.stringify(payload), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${name}.json"`,
        },
      });
    }

    const { stream } = writeArchive(payload, runtime.storage);
    return new Response(stream, {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${name}.zip"`,
      },
    });
  });

  /** Superadmin only: it creates a space. */
  app.post('/transfer/import', principal(runtime), requireSuperadmin, async (c) => {
    // `requireSuperadmin` guarantees a principal.
    const { userId } = principalOf(c) as Principal;
    await runtime.manablox.controls.assertWritable(null);
    if (!c.req.raw.body) throw ManabloxError.badRequest('space.import.notAnExport');

    const { sections, selection } = parseSelection(c.req.query(), sectionKinds(runtime));

    // Spooled to disk with a size cap, since the archive is read twice.
    const dir = await mkdtemp(join(tmpdir(), 'manablox-import-'));
    const upload = join(dir, 'space.manablox');
    try {
      await pipeline(
        Readable.fromWeb(c.req.raw.body as NodeReadableStream<Uint8Array>),
        cappedAt(MAX_UPLOAD_BYTES),
        createWriteStream(upload),
      );
      // Accepts a zip archive or a plain JSON export; only the archive carries files.
      const { manifest, payload } = await readUploadedExport(upload);

      const wantFiles = sections.length === 0 || sections.includes('files');
      // Staged before any database write; the service keeps only restored assets' files.
      const files =
        manifest && wantFiles
          ? (sink: ImportFileSink) =>
              extractFiles(
                createReadStream(upload),
                new Map((manifest.assets ?? []).map((asset) => [asset.key, asset.mimeType])),
                sink,
              )
          : undefined;
      const result = await runtime.spaces.import(payload, userId, selection, files);

      return c.json(result, 201);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  return app;
}

/** Upload size cap. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** Passes bytes through, failing once more than `max` have passed. */
function cappedAt(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > max) {
        done(ManabloxError.badRequest('space.import.tooLarge', { maxUploadBytes: max }));
        return;
      }
      done(null, chunk);
    },
  });
}

/** The data provider sections the instance knows. */
const sectionKinds = (runtime: Runtime): string[] =>
  transferProviders(runtime.manablox).map(({ kind }) => kind);

/**
 * Reads `sections=a,b,c` or `selection=<json>` (a `TransferSelection`, with `files` allowed
 * among its sections).
 */
function parseSelection(
  query: Record<string, string>,
  kinds: readonly string[],
): {
  sections: ArchiveSection[];
  selection: TransferSelection | undefined;
} {
  const raw = query.selection;
  if (!raw) {
    const sections = parseSections(query.sections, kinds);
    return {
      sections,
      selection: sections.length ? { sections: withoutFiles(sections) } : undefined,
    };
  }

  let parsed: { sections?: unknown; ids?: unknown; contents?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw ManabloxError.badRequest('validation.failed', { selection: raw });
  }
  const sections = Array.isArray(parsed.sections)
    ? parseSections(parsed.sections.join(','), kinds)
    : [];
  return {
    sections,
    selection: {
      ...(sections.length ? { sections: withoutFiles(sections) } : {}),
      ...(parsed.ids ? { ids: parsed.ids as TransferSelection['ids'] } : {}),
      ...(parsed.contents ? { contents: parsed.contents as TransferSelection['contents'] } : {}),
    },
  };
}

/** Parses `a,b,c`; empty means all. Unknown names are rejected. */
function parseSections(raw: string | undefined, kinds: readonly string[]): ArchiveSection[] {
  if (!raw) return [];
  const names = raw
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const unknown = names.filter((name) => !isArchiveSection(name, kinds));
  if (unknown.length) {
    throw ManabloxError.badRequest('validation.failed', { sections: unknown });
  }
  return names as ArchiveSection[];
}

const withoutFiles = (sections: ArchiveSection[]): SpaceExportSection[] =>
  sections.filter((section) => section !== 'files');
