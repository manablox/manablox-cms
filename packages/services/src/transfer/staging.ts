import type { Readable } from 'node:stream';

/** The storage an import stages its file in; a `StorageDriver` fits. */
export interface ImportStorage {
  put(key: string, body: Buffer | Readable, options: { contentType: string }): Promise<unknown>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  deletePrefix?(prefix: string): Promise<void>;
}

/** Where archive files are handed over, by storage key. */
export interface ImportFileSink {
  put(key: string, body: Buffer, options: { contentType: string }): Promise<unknown>;
}

/** Walks an archive's files into `sink`. */
export type ImportFileSource = (sink: ImportFileSink) => Promise<unknown>;

interface StagedFile {
  key: string;
  contentType: string;
}

/** Staging prefix of all imports. */
const IMPORT_STAGING_PREFIX = 'imports/';

/**
 * An import's staging area: the export file (so Resume needs no upload), its asset files and
 * their list, under `imports/<id>/`.
 */
export class ImportStaging {
  private readonly root: string;
  private readonly staged: StagedFile[] = [];

  constructor(
    private readonly storage: ImportStorage,
    readonly id: string,
  ) {
    this.root = `${IMPORT_STAGING_PREFIX}${id}/`;
  }

  /** Copies the export and the archive entries in `wanted`. */
  async stage(
    payload: unknown,
    source: ImportFileSource | undefined,
    wanted: Map<string, string>,
  ): Promise<void> {
    await this.storage.put(`${this.root}space.json`, Buffer.from(JSON.stringify(payload)), {
      contentType: 'application/json',
    });
    if (source && wanted.size) {
      await source({
        put: async (key, body) => {
          const contentType = wanted.get(key);
          if (!contentType) return;
          await this.storage.put(this.fileKey(key), body, { contentType });
          this.staged.push({ key, contentType });
        },
      });
    }
    await this.storage.put(`${this.root}files.json`, Buffer.from(JSON.stringify(this.staged)), {
      contentType: 'application/json',
    });
  }

  async payload(): Promise<unknown> {
    return JSON.parse((await this.storage.get(`${this.root}space.json`)).toString('utf8'));
  }

  /** Copies every staged file to its key; returns the count. */
  async place(): Promise<number> {
    const files = await this.files();
    for (const file of files) {
      await this.storage.put(file.key, await this.storage.stream(this.fileKey(file.key)), {
        contentType: file.contentType,
      });
    }
    return files.length;
  }

  /** Deletes everything staged. */
  async remove(): Promise<void> {
    const files = [...this.staged, ...(await this.files().catch(() => []))];
    for (const key of new Set(files.map((file) => this.fileKey(file.key)))) {
      await this.storage.delete(key);
    }
    await this.storage.delete(`${this.root}files.json`);
    await this.storage.delete(`${this.root}space.json`);
    await this.storage.deletePrefix?.(this.root);
  }

  private async files(): Promise<StagedFile[]> {
    return JSON.parse(
      (await this.storage.get(`${this.root}files.json`)).toString('utf8'),
    ) as StagedFile[];
  }

  private fileKey(key: string): string {
    return `${this.root}files/${key}`;
  }
}
