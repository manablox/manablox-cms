/** The table DSL, the core table definitions and the dialect builders, for plugin tables. */
export * from './definitions/define.js';
export * from './definitions/index.js';
export { environmentId, hostVerification } from './definitions/scoped.js';
export * from './plugin-tables.js';
export { type PostgresTable, postgresTable } from './postgres/table.js';
export { type SqliteTable, sqliteTable } from './sqlite/table.js';
