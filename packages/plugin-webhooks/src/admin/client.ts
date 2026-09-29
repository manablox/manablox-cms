import { pluginClient } from '@manablox/admin-sdk';
// The router's types read the plugin's hook names.
import type {} from '../server/hooks';
import type { WebhooksRouter } from '../server/rpc';

/** The webhooks plugin's management router, `plugins.webhooks`. */
export const webhooksApi = pluginClient<WebhooksRouter>('webhooks');
