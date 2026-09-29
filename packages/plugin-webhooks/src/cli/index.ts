/**
 * `@manablox/plugin-webhooks/cli`: the webhooks plugin's part of the `manablox` CLI. The help
 * imports this module, so it only describes; the templates are read when an instance is created.
 */
import type { CliContribution } from '@manablox/core';

const contribution: CliContribution = {
  summary: 'Webhooks: calls to other systems when content changes, and endpoints they call',
  templates: async (context) => (await import('./templates.js')).webhooksTemplates(context),
};

export default contribution;
