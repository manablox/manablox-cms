import { customType } from 'drizzle-orm/pg-core';

/** `ltree`: a node's materialised ancestor path. */
export const ltree = customType<{ data: string; driverData: string }>({
  dataType: () => 'ltree',
});

/** `tsvector`, generated; never written directly. */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

/** ltree labels allow only `[A-Za-z0-9_]`, so UUID hyphens become underscores. */
export const idToLabel = (id: string): string => id.replaceAll('-', '_');
export const labelToId = (label: string): string => label.replaceAll('_', '-');
