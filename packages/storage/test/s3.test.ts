import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { S3StorageDriver } from '../src/index.js';

/** A driver whose client records commands and answers with `reply`. */
function driverWith(
  reply: (command: { constructor: { name: string }; input: unknown }) => unknown,
) {
  const driver = new S3StorageDriver({
    bucket: 'b',
    endpoint: 'http://s3.test',
    accessKeyId: 'k',
    secretAccessKey: 's',
  });
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client = (driver as unknown as { client: { send: unknown } }).client;
  client.send = async (command: { constructor: { name: string }; input: unknown }) => {
    sent.push({ name: command.constructor.name, input: command.input as Record<string, unknown> });
    return reply(command);
  };
  return { driver, sent };
}

const s3Error = (name: string, status: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

describe('s3 driver', () => {
  it('uploads a stream without buffering it first and reports its size', async () => {
    const { driver, sent } = driverWith(async (command) => {
      const body = (command.input as { Body: unknown }).Body;
      // Drain what the upload hands over, as S3 would.
      if (body instanceof Readable) for await (const _ of body);
      return { ETag: '"e"' };
    });
    const stored = await driver.put(
      'a/b.txt',
      Readable.from([Buffer.from('he'), Buffer.from('llo')]),
      {
        contentType: 'text/plain',
        cacheControl: 'max-age=60',
      },
    );

    expect(stored).toEqual({ key: 'a/b.txt', size: 5, contentType: 'text/plain' });
    expect(sent[0]?.input).toMatchObject({
      Bucket: 'b',
      Key: 'a/b.txt',
      ContentType: 'text/plain',
      CacheControl: 'max-age=60',
    });
  });

  it('uploads a buffer', async () => {
    const { driver } = driverWith(async () => ({ ETag: '"e"' }));
    const stored = await driver.put('x', Buffer.from('abc'), { contentType: 'text/plain' });
    expect(stored.size).toBe(3);
  });

  it('reads a missing object as absent', async () => {
    const { driver } = driverWith(async () => {
      throw s3Error('NotFound', 404);
    });
    expect(await driver.exists('gone')).toBe(false);
  });

  it('rethrows a denied or failed HEAD rather than calling the object missing', async () => {
    const { driver } = driverWith(async () => {
      throw s3Error('Forbidden', 403);
    });
    await expect(driver.exists('secret')).rejects.toThrow('Forbidden');
  });
});

describe('s3 listing', () => {
  it('pages through every object under the prefix', async () => {
    const at = new Date('2026-09-25T10:00:00Z');
    const { driver, sent } = driverWith(async (command) => {
      const input = command.input as { ContinuationToken?: string };
      return input.ContinuationToken
        ? { Contents: [{ Key: 'p/b', Size: 2, LastModified: at }], IsTruncated: false }
        : {
            Contents: [{ Key: 'p/a', Size: 1, LastModified: at }],
            IsTruncated: true,
            NextContinuationToken: 't1',
          };
    });

    expect(await driver.list('p/')).toEqual([
      { key: 'p/a', size: 1, lastModified: at },
      { key: 'p/b', size: 2, lastModified: at },
    ]);
    expect(sent.map((entry) => entry.name)).toEqual([
      'ListObjectsV2Command',
      'ListObjectsV2Command',
    ]);
    expect(sent[0]?.input).toMatchObject({ Bucket: 'b', Prefix: 'p/' });
    expect(sent[1]?.input).toMatchObject({ ContinuationToken: 't1' });
  });

  it('lists nothing when the prefix is empty', async () => {
    const { driver } = driverWith(async () => ({ IsTruncated: false }));
    expect(await driver.list('none/')).toEqual([]);
  });
});
