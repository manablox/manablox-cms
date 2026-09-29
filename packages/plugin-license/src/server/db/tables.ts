import { id, integer, json, table, text, timestamp, uniqueIndex } from '@manablox/db/definitions';
import type { LicenseKeyError, LicenseKeySource, LicenseKind } from '../../sdk.js';

/**
 * One license key of the instance and its activation on the license server. Instance-wide:
 * no space owns it, so environments, transfers and snapshots never carry it; a backup does.
 * A key from the environment is matched by `keyHash` and never stored; one added in the
 * admin is kept encrypted in `keyEnc`.
 */
export const licenseActivations = table(
  'license_activations',
  {
    id: id(),
    source: text<LicenseKeySource>().notNull(),
    /** The key's first group, shown in place of the key. */
    keyId: text().notNull(),
    /** sha256 of the normalised key. */
    keyHash: text().notNull(),
    /** Admin keys: encrypted with the instance secret. */
    keyEnc: text(),
    /** The license server's activation id; `null` before an activation and after a deactivation. */
    activationId: text(),
    kind: text<LicenseKind>(),
    /** The signed lease, verified by every process on reading. */
    lease: text(),
    leaseExp: timestamp(),
    /** Encrypted with the instance secret; rotated by every refresh. */
    refreshSecret: text(),
    refreshedAt: timestamp(),
    lastError: json<LicenseKeyError>(),
    /** Failed calls in a row, for the backoff. */
    failures: integer().notNull().default(0),
    /** No automatic call before this. */
    retryAt: timestamp(),
    /** The license server saw the activation refreshed by two instances. */
    conflictAt: timestamp(),
    /** Deactivated here; not activated again until someone asks. */
    deactivatedAt: timestamp(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('license_activations_key_hash_key').on(t.keyHash)],
);
