import { type BuiltTables, buildTables, type DatabaseContext } from '@manablox/db';
import * as tables from './tables.js';

export type WebsiteTables = BuiltTables<typeof tables>;

export type SiteDesignRow = WebsiteTables['websiteDesigns']['$inferSelect'];
export type SiteDesignVersionRow = WebsiteTables['websiteDesignVersions']['$inferSelect'];
export type SiteDomainRow = WebsiteTables['websiteDomains']['$inferSelect'];

/** The website tables of a connection or transaction's dialect. */
export const websiteTables = (context: DatabaseContext): WebsiteTables =>
  buildTables(tables, context.dialect.name);
