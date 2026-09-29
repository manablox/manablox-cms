import { pipeline, type Readable, Transform } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3StorageConfig } from '@manablox/core';
import {
  type ByteRange,
  isMissingObject,
  type ListedObject,
  type PutOptions,
  type StorageDriver,
  type StoredObject,
} from './driver.js';

export type S3DriverConfig = S3StorageConfig;

export class S3StorageDriver implements StorageDriver {
  readonly name = 's3';
  private readonly client: S3Client;

  constructor(private readonly config: S3DriverConfig) {
    this.client = new S3Client({
      region: config.region ?? 'us-east-1',
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  /** Streams in multipart chunks, so a large upload is never held in memory whole. */
  async put(key: string, body: Buffer | Readable, options: PutOptions): Promise<StoredObject> {
    let size = Buffer.isBuffer(body) ? body.byteLength : 0;
    const counted = Buffer.isBuffer(body) ? body : countBytes(body, (bytes) => (size += bytes));

    await new Upload({
      client: this.client,
      params: {
        Bucket: this.config.bucket,
        Key: key,
        Body: counted,
        ContentType: options.contentType,
        ...(options.cacheControl ? { CacheControl: options.cacheControl } : {}),
      },
    }).done();
    return { key, size, contentType: options.contentType };
  }

  async get(key: string): Promise<Buffer> {
    return streamToBuffer(await this.stream(key));
  }

  async stream(key: string, range?: ByteRange): Promise<Readable> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    return result.Body as Readable;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch (error) {
      // Only a 404 is absence; a 403 or network failure is not.
      if (isMissingObject(error)) return false;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  /** Pages through ListObjectsV2; S3 returns keys in order. */
  async list(prefix: string): Promise<ListedObject[]> {
    const out: ListedObject[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ...(token ? { ContinuationToken: token } : {}),
        }),
      );
      for (const item of page.Contents ?? []) {
        if (!item.Key) continue;
        out.push({
          key: item.Key,
          size: item.Size ?? 0,
          lastModified: item.LastModified ?? new Date(0),
        });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  url(key: string): string | null {
    return this.config.publicUrl ? `${this.config.publicUrl.replace(/\/$/, '')}/${key}` : null;
  }

  async presignPut(key: string, contentType: string, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Passes the stream through, reporting each chunk's size; a source error fails it. */
function countBytes(source: Readable, onBytes: (bytes: number) => void): Transform {
  const through = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      onBytes(chunk.byteLength);
      done(null, chunk);
    },
  });
  pipeline(source, through, () => {});
  return through;
}
