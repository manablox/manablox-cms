/** The SQLite tables, for drizzle-kit. */
import { sqliteTable } from '@manablox/db/definitions';
import * as tables from '../tables.js';

export const websiteDesigns = sqliteTable(tables.websiteDesigns);
export const websiteDesignVersions = sqliteTable(tables.websiteDesignVersions);
export const websiteDomains = sqliteTable(tables.websiteDomains);
