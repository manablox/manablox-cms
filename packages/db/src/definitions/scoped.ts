import { text, timestamp, uuid } from './define.js';
import { spaceEnvironments } from './spaces.js';

/** The environment an environment-scoped row belongs to. */
export const environmentId = () =>
  uuid()
    .notNull()
    .references(() => spaceEnvironments, 'id', { onDelete: 'cascade' });

/** DNS ownership proof of a host; `verifiedAt` null is pending, or failed with `verificationFailedAt`. */
export function hostVerification() {
  return {
    verifiedAt: timestamp(),
    /** The value of the `_manablox.<host>` TXT record. */
    verificationToken: text(),
    /** When the current check window opened. */
    verificationStartedAt: timestamp(),
    verificationCheckedAt: timestamp(),
    /** The window closed without a match; the periodic check stops. */
    verificationFailedAt: timestamp(),
  };
}
