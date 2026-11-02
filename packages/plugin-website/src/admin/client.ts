import { pluginClient } from '@manablox/admin-sdk';
import type { WebsiteRouter } from '../index';

/** The website plugin's management router, `plugins.website`. */
export const websiteApi = pluginClient<WebsiteRouter>('website');
