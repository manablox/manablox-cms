import { Readable } from 'node:stream';
import type { SnapshotStorage } from '../../src/snapshots/layout.js';
import type { ImportStorage } from '../../src/transfer/staging.js';

/** Storage in a map, for staging and snapshot tests. */
export function memoryStorage(): ImportStorage &
  Required<SnapshotStorage> & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  const read = (key: string) => {
    const body = objects.get(key);
    if (!body) throw Object.assign(new Error(`missing ${key}`), { code: 'ENOENT' });
    return body;
  };
  return {
    objects,
    async put(key, body) {
      if (Buffer.isBuffer(body)) {
        objects.set(key, body);
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
      objects.set(key, Buffer.concat(chunks));
    },
    async get(key) {
      return read(key);
    },
    async stream(key) {
      return Readable.from([read(key)]);
    },
    async delete(key) {
      objects.delete(key);
    },
    async list(prefix) {
      return [...objects]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, body]) => ({ key, size: body.byteLength, lastModified: new Date() }));
    },
  };
}
