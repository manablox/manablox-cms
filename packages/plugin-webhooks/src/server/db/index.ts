import { pluginRepos } from '@manablox/db';
import { WebhookRepository } from './repository.js';

/**
 * Endpoint change listeners of the process, shared by every connection and transaction, so a
 * change committed through any of them is heard.
 */
const changeListeners = new Set<(spaceId: string) => void>();

/** The endpoints and their log on the connection or transaction `repos` is bound to. */
export const webhookRepos = pluginRepos(
  (context) => new WebhookRepository(context, changeListeners),
);

export * from './repository.js';
export * from './rows.js';
