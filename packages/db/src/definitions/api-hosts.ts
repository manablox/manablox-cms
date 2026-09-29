import { id, index, table, text, timestamp, uniqueIndex, uuid } from './define.js';
import { environmentId, hostVerification } from './scoped.js';
import { spaces } from './spaces.js';

/** A host name the public API serves a space under, when no space is pinned. */
export const spaceApiHosts = table(
  'space_api_hosts',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    environmentId: environmentId(),
    /** Normalised; unique across spaces. */
    hostname: text().notNull(),
    ...hostVerification(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('space_api_hosts_hostname_key').on(t.hostname),
    index('space_api_hosts_space_idx').on(t.spaceId),
  ],
);
