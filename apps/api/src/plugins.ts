import { envList, envOptional, type ManabloxPlugin } from '@manablox/core';
import { manabloxFields } from '@manablox/fields';
import { aiPlugin } from '@manablox/plugin-ai';
import { webhooksPlugin } from '@manablox/plugin-webhooks';
import { websitePlugin } from '@manablox/plugin-website';
import { workflowsPlugin } from '@manablox/plugin-workflows';

/** The instance's plugins; the migrate command reads them without the rest of the config. */
export const plugins: ManabloxPlugin[] = [
  manabloxFields(),
  workflowsPlugin(),
  webhooksPlugin(),
  // Private-network hosts a self-hosted AI provider may reach, as `host` or `host:port`.
  aiPlugin({ allowedHosts: envList('AI_ALLOWED_HOSTS', []) }),
  websitePlugin({
    // The site process, which the admin frames for the design canvas.
    url: envOptional('SITE_URL'),
    // Accepts the site process's form submissions at /plugins/website/forms/submit.
    forms: { secret: envOptional('SITE_FORMS_SECRET') },
  }),
];
