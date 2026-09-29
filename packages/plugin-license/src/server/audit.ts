import type { PluginAudit } from '@manablox/core';

/** The audit entity of license keys; entries name the key by its id, never the key. */
export const LICENSE_KEY_ENTITY = 'license.key';

/** Keys added, removed, activated and deactivated in the admin. */
export const licenseAudit: PluginAudit = { entities: [LICENSE_KEY_ENTITY] };
