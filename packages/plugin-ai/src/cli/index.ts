/**
 * `@manablox/plugin-ai/cli`: the AI plugin's part of the `manablox` CLI. The help imports
 * this module, so it only describes; the templates are read when an instance is created.
 */
import type { CliContribution } from '@manablox/core';

const contribution: CliContribution = {
  summary: 'AI assistance: text, image and model generation with your own provider keys',
  templates: async (context) => (await import('./templates.js')).aiTemplates(context),
};

export default contribution;
