import { ManabloxError, type StorageConfig } from '@manablox/core';
import type { StorageDriver, StorageDriverFactory } from './driver.js';
import { LocalStorageDriver } from './local.js';
import { S3StorageDriver } from './s3.js';

export * from './driver.js';
export * from './local.js';
export * from './s3.js';

const registry = new Map<string, StorageDriverFactory>();

export function registerStorageDriver(name: string, factory: StorageDriverFactory): void {
  registry.set(name, factory);
}

export function createStorageDriver(config: StorageConfig): StorageDriver {
  if (config.driver === 'local') {
    if (!config.local) throw ManabloxError.badRequest('storage.local.configMissing');
    return new LocalStorageDriver(config.local);
  }

  if (config.driver === 's3') {
    if (!config.s3) throw ManabloxError.badRequest('storage.s3.configMissing');
    return new S3StorageDriver(config.s3);
  }

  const factory = registry.get(config.driver);
  if (!factory) throw ManabloxError.notFound('storage.driver.notFound', { driver: config.driver });
  return factory(config as unknown as Record<string, unknown>);
}

/** Builds `<space>/<year>/<month>/<name>.<ext>` with a random discriminator. */
export function buildStorageKey(spaceId: string, filename: string, at = new Date()): string {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';

  const safeStem =
    stem
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 80) || 'file';

  const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 10);
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  const discriminator = Math.random().toString(36).slice(2, 8);

  return `${spaceId}/${year}/${month}/${safeStem}-${discriminator}${safeExt ? `.${safeExt}` : ''}`;
}
