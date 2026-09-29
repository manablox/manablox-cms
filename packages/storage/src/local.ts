import { randomUUID } from 'node:crypto';
import { createReadStream, type Dirent } from 'node:fs';
import {
  type FileHandle,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
} from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { type LocalStorageConfig, ManabloxError } from '@manablox/core';
import type { ByteRange, ListedObject, PutOptions, StorageDriver, StoredObject } from './driver.js';

export type LocalDriverConfig = LocalStorageConfig;

export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly root: string;

  constructor(private readonly config: LocalDriverConfig) {
    this.root = resolve(config.path);
  }

  /** Writes to a sibling temp file and renames it, so readers never see a partial object. */
  async put(key: string, body: Buffer | Readable, options: PutOptions): Promise<StoredObject> {
    const target = this.resolveKey(key);
    const temp = `${target}.${randomUUID()}.tmp`;
    const file = await createFile(temp);
    try {
      if (Buffer.isBuffer(body)) {
        await file.writeFile(body);
        await file.close();
      } else {
        // The stream closes the handle.
        await pipeline(body, file.createWriteStream());
      }
      const { size } = await stat(temp);
      await rename(temp, target);
      return { key, size, contentType: options.contentType };
    } catch (error) {
      await file.close().catch(() => {});
      await rm(temp, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async stream(key: string, range?: ByteRange): Promise<Readable> {
    return createReadStream(
      this.resolveKey(key),
      range ? { start: range.start, end: range.end } : undefined,
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch (error) {
      // Only a missing path is absence; permission and I/O errors are not.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return false;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  /** Walks the directory the prefix names up to its last slash; files mid-write are skipped. */
  async list(prefix: string): Promise<ListedObject[]> {
    const wanted = prefix.replace(/^\/+/, '');
    const dir = wanted.slice(0, wanted.lastIndexOf('/') + 1);
    const out: ListedObject[] = [];
    const walk = async (path: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await readdir(path, { withFileTypes: true });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return;
        throw error;
      }
      for (const entry of entries) {
        const full = join(path, entry.name);
        const key = relative(this.root, full).split(sep).join('/');
        if (entry.isDirectory()) {
          if (key.startsWith(wanted) || wanted.startsWith(`${key}/`)) await walk(full);
        } else if (entry.isFile() && key.startsWith(wanted) && !TEMP_FILE.test(entry.name)) {
          const info = await stat(full).catch(() => null);
          if (info) out.push({ key, size: info.size, lastModified: info.mtime });
        }
      }
    };
    await walk(this.resolveKey(dir));
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  /** Also removes the parent directories it leaves empty, up to the root. */
  async deletePrefix(prefix: string): Promise<void> {
    const target = this.resolveKey(prefix);
    await rm(target, { recursive: true, force: true });
    for (let dir = dirname(target); dir.startsWith(this.root + sep); dir = dirname(dir)) {
      try {
        await rmdir(dir);
      } catch {
        return;
      }
    }
  }

  url(key: string): string | null {
    return this.config.publicUrl ? `${this.config.publicUrl.replace(/\/$/, '')}/${key}` : null;
  }

  /** Resolves a key inside the storage root; traversal is rejected, not sanitised. */
  private resolveKey(key: string): string {
    // A leading slash means the store root.
    const normalised = normalize(key.replace(/^\/+/, ''));

    if (
      normalised === '..' ||
      normalised.startsWith(`..${sep}`) ||
      normalised.includes(`${sep}..${sep}`)
    ) {
      throw ManabloxError.badRequest('storage.key.traversal', { key });
    }

    const target = resolve(join(this.root, normalised));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw ManabloxError.badRequest('storage.key.traversal', { key });
    }
    return target;
  }
}

/** The sibling `put` writes before renaming it into place. */
const TEMP_FILE = /\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

/** Opens a new file, creating its directory; again if a prefix delete pruned it meanwhile. */
async function createFile(path: string): Promise<FileHandle> {
  for (let attempt = 0; ; attempt++) {
    await mkdir(dirname(path), { recursive: true });
    try {
      return await open(path, 'wx');
    } catch (error) {
      if (attempt > 0 || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
