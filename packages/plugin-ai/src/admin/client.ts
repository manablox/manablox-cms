import { pluginClient } from '@manablox/admin-sdk';
import type { AiRouter } from '../server/rpc';

/** The AI plugin's management router, `plugins.ai`. */
export const aiApi = pluginClient<AiRouter>('ai');
