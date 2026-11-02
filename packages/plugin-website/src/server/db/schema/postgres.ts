/** The Postgres tables, for drizzle-kit. */
import { postgresTable } from '@manablox/db/definitions';
import * as tables from '../tables.js';

export const websiteDesigns = postgresTable(tables.websiteDesigns);
export const websiteDesignVersions = postgresTable(tables.websiteDesignVersions);
export const websiteDomains = postgresTable(tables.websiteDomains);
