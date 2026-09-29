import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readUploadedExport } from '../src/transfer/upload.js';

/** The upload format is detected from the bytes, not the content type. */
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'manablox-upload-test-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = async (name: string, contents: Buffer | string): Promise<string> => {
  const path = join(dir, name);
  await writeFile(path, contents);
  return path;
};

const exported = { manabloxSpaceExport: 1, sections: [], space: { machineName: 'site' } };

describe('an uploaded export', () => {
  it('reads a JSON export, with no manifest to take files from', async () => {
    const path = await write('space.json', JSON.stringify(exported));

    const { manifest, payload } = await readUploadedExport(path);

    expect(manifest).toBeNull();
    expect(payload).toEqual(exported);
  });

  it('reads an archive through its manifest, whatever the file is called', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const archive = Buffer.from(
      zipSync({
        'space.json': strToU8(JSON.stringify({ ...exported, archive: { files: 0 } })),
        'files/site/one.png': new Uint8Array([1, 2, 3]),
      }),
    );
    const path = await write('space.json.but-a-zip', archive);

    const { manifest, payload } = await readUploadedExport(path);

    expect(manifest?.space.machineName).toBe('site');
    expect(payload).toBe(manifest);
  });

  it('refuses a file that is not an export', async () => {
    const path = await write('notes.txt', 'not JSON at all');

    await expect(readUploadedExport(path)).rejects.toMatchObject({
      key: 'space.import.notAnExport',
    });
  });

  it('refuses a JSON export too large to parse', async () => {
    const path = await write('big.json', JSON.stringify(exported));

    await expect(readUploadedExport(path, 8)).rejects.toMatchObject({
      key: 'space.import.tooLarge',
    });
  });
});
