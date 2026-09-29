import { CONTENT_EVENTS, type PluginLlmsContext } from '@manablox/core';
import { WEBHOOK_AUTH_MODES } from '../sdk.js';

/** The webhooks plugin's section of the LLM guide: endpoints either direction. */
export function webhookLlms({ baseUrl }: PluginLlmsContext): string {
  return [
    '### Webhooks',
    '',
    `A **webhook** is an endpoint either direction; its procedures are under \`plugins.webhooks\`. An outgoing one (\`direction: "outgoing"\`, \`url\`, \`events\`: ${CONTENT_EVENTS.map((event) => `\`${event}\``).join(', ')}, all when empty) is called when content changes. An incoming one (\`direction: "incoming"\`, \`slug\`, \`methods\`) is a URL other systems call: \`${baseUrl.replace(/\/+$/, '')}/plugins/webhooks/in/<spaceId>/<slug>\` (a staging environment's names it between the two), which answers 202 and starts what listens on it, such as workflows.`,
    '',
    `- \`plugins.webhooks.create\` takes \`{spaceId, direction, name, slug, url, events, headers, methods, auth, enabled}\`; \`auth.mode\` is one of ${WEBHOOK_AUTH_MODES.map((mode) => `\`${mode}\``).join(', ')}, each but \`none\` with a \`credentialId\` of the space's vault.`,
    '- `plugins.webhooks.deliveries` `{spaceId, id}` reads the calls over an endpoint, newest first; `plugins.webhooks.test` sends a test call and `plugins.webhooks.retry` sends a logged outgoing one again.',
  ].join('\n');
}
