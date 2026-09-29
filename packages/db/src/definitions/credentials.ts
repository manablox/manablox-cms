import type { CredentialKind, ResourceSource } from '@manablox/core';
import { id, table, text, timestamp, unique, uuid } from './define.js';
import { spaces } from './spaces.js';

/**
 * The credential vault: a secret a workflow action or a webhook authenticates with. `data` is
 * one AES-256-GCM blob over the field map; only the credential service opens it and it never
 * reaches a browser. The table keeps its historical name.
 */
export const credentials = table(
  'credentials',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    name: text().notNull(),
    /** Referenced by nodes in exports. */
    slug: text().notNull(),
    kind: text<CredentialKind>().notNull(),
    source: text<ResourceSource>().notNull().default('runtime'),
    sourceRef: text(),
    /** Target service, e.g. `trello`; empty for generic. */
    provider: text().notNull().default(''),
    /** Ciphertext of `{ field: value }`; null until filled in. */
    data: text(),
    /** Last four characters of the first secret. */
    hint: text(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [unique('credentials_space_slug_key').on(t.spaceId, t.slug)],
);
