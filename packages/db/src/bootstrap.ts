import type { Sql } from './client.js';

/** Extensions the schema needs; run before migrations. */
export async function applyBootstrapSql(sql: Sql): Promise<void> {
  await sql.unsafe(`
    create extension if not exists "ltree";
    create extension if not exists "pg_trgm";
    create extension if not exists "btree_gin";
  `);
}
