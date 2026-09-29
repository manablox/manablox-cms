import { migrateDatabase } from '../migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

await migrateDatabase(
  {
    url,
    ...(process.env.DATABASE_AUTH_TOKEN ? { authToken: process.env.DATABASE_AUTH_TOKEN } : {}),
    ...(process.env.MIGRATION_DATABASE_URL
      ? { migrationUrl: process.env.MIGRATION_DATABASE_URL }
      : {}),
  },
  { warn: (line) => console.warn(line) },
);
console.info('migrations applied');
