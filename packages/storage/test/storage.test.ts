import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildStorageKey, LocalStorageDriver } from '../src/index.js';

let root: string;
let driver: LocalStorageDriver;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'manablox-storage-'));
  driver = new LocalStorageDriver({ path: root, publicUrl: 'https://cdn.example.com/files' });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('local driver', () => {
  it('round-trips an object', async () => {
    const body = Buffer.from('hello');
    const stored = await driver.put('space/2026/09/a.txt', body, { contentType: 'text/plain' });

    expect(stored.size).toBe(5);
    expect(await driver.exists('space/2026/09/a.txt')).toBe(true);
    expect((await driver.get('space/2026/09/a.txt')).toString()).toBe('hello');
  });

  it('streams a readable to disk and reports its size', async () => {
    const body = Readable.from([Buffer.from('stre'), Buffer.from('amed')]);
    const stored = await driver.put('streams/a.txt', body, { contentType: 'text/plain' });
    expect(stored.size).toBe(8);
    expect((await driver.get('streams/a.txt')).toString()).toBe('streamed');
  });

  it('leaves neither the object nor a temp file behind when the stream fails', async () => {
    const body = new Readable({
      read() {
        this.push(Buffer.from('part'));
        this.destroy(new Error('source broke'));
      },
    });
    await expect(driver.put('broken/a.txt', body, { contentType: 'text/plain' })).rejects.toThrow(
      'source broke',
    );
    expect(await driver.exists('broken/a.txt')).toBe(false);
    expect(await readdir(join(root, 'broken'))).toEqual([]);
  });

  it('deletes without failing on a missing key', async () => {
    await driver.put('gone.txt', Buffer.from('x'), { contentType: 'text/plain' });
    await driver.delete('gone.txt');
    await driver.delete('gone.txt');
    expect(await driver.exists('gone.txt')).toBe(false);
  });

  it('exposes a public URL only when one is configured', () => {
    expect(driver.url('a/b.png')).toBe('https://cdn.example.com/files/a/b.png');
    expect(new LocalStorageDriver({ path: root }).url('a/b.png')).toBeNull();
  });

  /** A traversing key must not escape the storage root. */
  it('refuses to write outside the storage root', async () => {
    for (const key of ['../escape.txt', '../../etc/passwd', 'a/../../escape.txt']) {
      await expect(
        driver.put(key, Buffer.from('x'), { contentType: 'text/plain' }),
      ).rejects.toThrow(/traversal/);
    }

    // Nothing landed above the root.
    await expect(readFile(join(root, '..', 'escape.txt'))).rejects.toThrow();
  });

  it('rejects rather than sanitising, so two keys cannot collide on one file', async () => {
    await driver.put('safe.txt', Buffer.from('original'), { contentType: 'text/plain' });
    // Sanitising `../safe.txt` to `safe.txt` would overwrite the object above.
    await expect(
      driver.put('../safe.txt', Buffer.from('overwritten'), { contentType: 'text/plain' }),
    ).rejects.toThrow(/traversal/);
    expect((await driver.get('safe.txt')).toString()).toBe('original');
  });

  it('normalises a leading slash rather than treating the key as absolute', async () => {
    await driver.put('/leading.txt', Buffer.from('ok'), { contentType: 'text/plain' });
    expect((await driver.get('leading.txt')).toString()).toBe('ok');
  });
});

describe('storage keys', () => {
  const at = new Date('2026-09-04T00:00:00Z');

  it('partitions by space, year and month', () => {
    const key = buildStorageKey('space-1', 'Photo.JPG', at);
    expect(key).toMatch(/^space-1\/2026\/09\/photo-[a-z0-9]{6}\.jpg$/);
  });

  /** Keys stay collision-free without touching the filesystem. */
  it('never collides for the same filename', () => {
    const keys = new Set(Array.from({ length: 500 }, () => buildStorageKey('s', 'same.png', at)));
    expect(keys.size).toBe(500);
  });

  it('sanitises names that could escape or confuse the path', () => {
    expect(buildStorageKey('s', '../../etc/passwd', at)).not.toContain('..');
    expect(buildStorageKey('s', 'a b/c\\d.png', at)).toMatch(
      /^s\/2026\/09\/a-b-c-d-[a-z0-9]{6}\.png$/,
    );
    expect(buildStorageKey('s', '', at)).toContain('/file-');
  });

  it('keeps an extensionless filename usable', () => {
    expect(buildStorageKey('s', 'README', at)).toMatch(/^s\/2026\/09\/readme-[a-z0-9]{6}$/);
  });
});
