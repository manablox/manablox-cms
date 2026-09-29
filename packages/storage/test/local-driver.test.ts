import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalStorageDriver } from '../src/index.js';

let root: string;
let driver: LocalStorageDriver;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'manablox-local-driver-'));
  driver = new LocalStorageDriver({ path: root });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const plain = { contentType: 'text/plain' };

describe('local driver streaming', () => {
  it('streams a stored object back', async () => {
    await driver.put('read/stream.txt', Readable.from(['a', 'b', 'c']), plain);
    expect(await text(await driver.stream('read/stream.txt'))).toBe('abc');
  });

  it('streams a large body through without truncating it', async () => {
    const chunk = Buffer.alloc(64 * 1024, 1);
    const chunks = Array.from({ length: 32 }, () => chunk);
    const stored = await driver.put('read/large.bin', Readable.from(chunks), {
      contentType: 'application/octet-stream',
    });
    expect(stored.size).toBe(32 * 64 * 1024);
    expect((await driver.get('read/large.bin')).length).toBe(stored.size);
  });

  it('fails the stream of a missing key with ENOENT', async () => {
    const stream = await driver.stream('read/missing.txt');
    await expect(text(stream)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails get on a missing key with ENOENT', async () => {
    await expect(driver.get('read/missing.txt')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('local driver writes', () => {
  it('returns the key, size and content type it was given', async () => {
    expect(
      await driver.put('write/a.json', Buffer.from('{}'), {
        contentType: 'application/json',
        cacheControl: 'no-cache',
      }),
    ).toEqual({ key: 'write/a.json', size: 2, contentType: 'application/json' });
  });

  it('replaces an existing object whole and leaves no temp file', async () => {
    await driver.put('write/replace.txt', Buffer.from('first version'), plain);
    await driver.put('write/replace.txt', Readable.from(['v2']), plain);
    expect((await driver.get('write/replace.txt')).toString()).toBe('v2');
    const files = await readdir(join(root, 'write'));
    expect(files.filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('local driver exists and delete', () => {
  it('reports a key below an existing file as absent', async () => {
    await driver.put('exists/file.txt', Buffer.from('x'), plain);
    expect(await driver.exists('exists/file.txt')).toBe(true);
    expect(await driver.exists('exists/file.txt/child')).toBe(false);
    expect(await driver.exists('exists/none.txt')).toBe(false);
  });

  it('deletes only the given key', async () => {
    await driver.put('delete/keep.txt', Buffer.from('k'), plain);
    await driver.put('delete/drop.txt', Buffer.from('d'), plain);
    await driver.delete('delete/drop.txt');
    expect(await driver.exists('delete/drop.txt')).toBe(false);
    expect(await driver.exists('delete/keep.txt')).toBe(true);
  });

  it('removes a prefix with the parent directories it leaves empty, never the root', async () => {
    await driver.put('imports/a/files/x.txt', Buffer.from('x'), plain);
    await driver.put('imports/a/space.json', Buffer.from('{}'), plain);
    await driver.put('kept/b/y.txt', Buffer.from('y'), plain);
    await driver.deletePrefix('imports/a/');
    expect(await readdir(root)).not.toContain('imports');

    await driver.put('kept/c/z.txt', Buffer.from('z'), plain);
    await driver.deletePrefix('kept/c/');
    expect(await readdir(join(root, 'kept'))).toEqual(['b']);

    const alone = await mkdtemp(join(tmpdir(), 'manablox-local-prefix-'));
    const own = new LocalStorageDriver({ path: alone });
    await own.put('only/one.txt', Buffer.from('1'), plain);
    await own.deletePrefix('only/');
    expect(await readdir(alone)).toEqual([]);
    await rm(alone, { recursive: true, force: true });
  });

  it('refuses traversing keys on every operation', async () => {
    const key = '../outside.txt';
    await expect(driver.get(key)).rejects.toMatchObject({ key: 'storage.key.traversal' });
    await expect(driver.stream(key)).rejects.toMatchObject({ key: 'storage.key.traversal' });
    await expect(driver.exists(key)).rejects.toMatchObject({ key: 'storage.key.traversal' });
    await expect(driver.delete(key)).rejects.toMatchObject({ key: 'storage.key.traversal' });
  });
});

describe('local driver public URL', () => {
  it('joins the key to the public URL without a double slash', () => {
    const withSlash = new LocalStorageDriver({ path: root, publicUrl: 'https://cdn.test/up/' });
    expect(withSlash.url('s/2026/a.png')).toBe('https://cdn.test/up/s/2026/a.png');
    const without = new LocalStorageDriver({ path: root, publicUrl: 'https://cdn.test/up' });
    expect(without.url('a.png')).toBe('https://cdn.test/up/a.png');
  });

  it('has no public URL for an empty publicUrl', () => {
    expect(new LocalStorageDriver({ path: root, publicUrl: '' }).url('a.png')).toBeNull();
  });
});

describe('local driver listing', () => {
  it('lists every object under a prefix, sorted, with size and date', async () => {
    await driver.put('list/a/2.txt', Buffer.from('22'), plain);
    await driver.put('list/a/1.txt', Buffer.from('1'), plain);
    await driver.put('list/a/deep/3.txt', Buffer.from('333'), plain);
    await driver.put('list/b/4.txt', Buffer.from('4'), plain);

    const listed = await driver.list('list/a/');
    expect(listed.map((entry) => [entry.key, entry.size])).toEqual([
      ['list/a/1.txt', 1],
      ['list/a/2.txt', 2],
      ['list/a/deep/3.txt', 3],
    ]);
    expect(listed[0]?.lastModified.getTime()).toBeGreaterThan(0);
  });

  it('matches a prefix that ends inside a name', async () => {
    await driver.put('names/2026-01-01.json', Buffer.from('x'), plain);
    await driver.put('names/2026-02-01.json', Buffer.from('x'), plain);
    await driver.put('names/2025-12-31.json', Buffer.from('x'), plain);
    expect((await driver.list('names/2026-')).map((entry) => entry.key)).toEqual([
      'names/2026-01-01.json',
      'names/2026-02-01.json',
    ]);
  });

  it('lists nothing under a missing prefix', async () => {
    expect(await driver.list('nothing-here/')).toEqual([]);
  });

  it('skips a file still being written', async () => {
    await driver.put('partial/done.txt', Buffer.from('x'), plain);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(root, 'partial', 'next.txt.0f8fad5b-d9cb-469f-a165-70867728950e.tmp'),
      'half',
    );
    expect((await driver.list('partial/')).map((entry) => entry.key)).toEqual(['partial/done.txt']);
  });

  it('refuses a prefix outside the root', async () => {
    await expect(driver.list('../elsewhere/')).rejects.toThrow();
  });
});

describe('local driver ranges', () => {
  it('streams the inclusive byte range asked for', async () => {
    await driver.put('read/range.txt', Buffer.from('0123456789'), plain);
    expect(await text(await driver.stream('read/range.txt', { start: 2, end: 5 }))).toBe('2345');
    expect(await text(await driver.stream('read/range.txt', { start: 9, end: 9 }))).toBe('9');
  });
});
