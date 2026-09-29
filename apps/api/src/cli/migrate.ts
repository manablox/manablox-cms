import { databaseConfigFromEnv } from '@manablox/core';
import { migrateDatabase } from '@manablox/db';
import { plugins } from '../plugins.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

await migrateDatabase(databaseConfigFromEnv(), { plugins, warn: (line) => console.warn(line) });
console.info('migrations applied');
