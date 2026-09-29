import type { Config } from 'drizzle-kit';

/** drizzle-kit's config type, so a config file's declarations can name it through this entry. */
export type { Config };

/**
 * A plugin's drizzle-kit config for one dialect: the schema in `<schemaDir>/postgres.ts` or
 * `sqlite.ts`, migrations in `migrations` or `migrations-sqlite`, snake_case columns.
 */
export function pluginDrizzleConfig(
  dialect: 'postgresql' | 'sqlite',
  schemaDir = './src/server/db/schema',
): Config {
  const sqlite = dialect === 'sqlite';
  return {
    schema: `${schemaDir}/${sqlite ? 'sqlite' : 'postgres'}.ts`,
    out: sqlite ? './migrations-sqlite' : './migrations',
    dialect,
    casing: 'snake_case',
  };
}
