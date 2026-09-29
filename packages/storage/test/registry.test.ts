import { describe, expect, it } from 'vitest';
import {
  createStorageDriver,
  isMissingObject,
  LocalStorageDriver,
  registerStorageDriver,
  S3StorageDriver,
  type StorageDriver,
} from '../src/index.js';

describe('createStorageDriver', () => {
  it('builds the local driver from its config', () => {
    const driver = createStorageDriver({ driver: 'local', local: { path: '/tmp/uploads' } });
    expect(driver).toBeInstanceOf(LocalStorageDriver);
    expect(driver.name).toBe('local');
  });

  it('builds the S3 driver from its config', () => {
    const driver = createStorageDriver({
      driver: 's3',
      s3: { bucket: 'b', region: 'eu-central-1', accessKeyId: 'a', secretAccessKey: 's' },
    });
    expect(driver).toBeInstanceOf(S3StorageDriver);
  });

  it('refuses a built-in driver without its config section', () => {
    expect(() => createStorageDriver({ driver: 'local' })).toThrow(
      expect.objectContaining({ key: 'storage.local.configMissing' }),
    );
    expect(() => createStorageDriver({ driver: 's3' })).toThrow(
      expect.objectContaining({ key: 'storage.s3.configMissing' }),
    );
  });

  it('builds a registered driver and hands it the whole config', () => {
    const seen: Record<string, unknown>[] = [];
    const custom = { name: 'memory' } as StorageDriver;
    registerStorageDriver('memory', (config) => {
      seen.push(config);
      return custom;
    });
    const config = { driver: 'memory', maxFileSize: 10 };
    expect(createStorageDriver(config)).toBe(custom);
    expect(seen).toEqual([config]);
  });

  it('reports an unknown driver as not found', () => {
    expect(() => createStorageDriver({ driver: 'nowhere' })).toThrow(
      expect.objectContaining({ key: 'storage.driver.notFound', kind: 'not_found' }),
    );
  });
});

describe('isMissingObject', () => {
  it('recognises a missing file and a missing S3 object', () => {
    expect(isMissingObject({ code: 'ENOENT' })).toBe(true);
    expect(isMissingObject({ name: 'NotFound' })).toBe(true);
    expect(isMissingObject({ name: 'NoSuchKey' })).toBe(true);
    expect(isMissingObject({ Code: 'NoSuchKey' })).toBe(true);
    expect(isMissingObject({ $metadata: { httpStatusCode: 404 } })).toBe(true);
  });

  it('does not call other failures missing', () => {
    expect(isMissingObject({ code: 'EACCES' })).toBe(false);
    expect(isMissingObject({ $metadata: { httpStatusCode: 403 } })).toBe(false);
    expect(isMissingObject(new Error('boom'))).toBe(false);
    expect(isMissingObject(null)).toBe(false);
    expect(isMissingObject(undefined)).toBe(false);
  });
});
