/**
 * `@manablox/plugin-workflows/cli`: the workflows plugin's part of the `manablox` CLI. The help
 * imports this module, so it only describes; the templates are read when an instance is created.
 */
import type { CliContribution } from '@manablox/core';

const contribution: CliContribution = {
  summary: 'Workflows: automations started by content changes, schedules and incoming webhooks',
  templates: async (context) => (await import('./templates.js')).workflowsTemplates(context),
};

export default contribution;
