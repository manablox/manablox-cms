import type { PluginControls } from '@manablox/core';

/** Features, usage, the call rate and retention under `plugins.ai`; the plugin's flag is AI itself. */
export const aiControls = {
  'features.plugins.ai.images': { label: 'AI images', description: 'AI image generation.' },
  'features.plugins.ai.video': { label: 'AI video', description: 'AI video generation.' },
  'features.plugins.ai.designModels': {
    label: 'Designing with AI',
    description: 'Designing types, templates, workflows and themes with AI.',
  },
  'features.plugins.ai.designSpace': {
    label: 'Designing a space with AI',
    description: 'Designing a new space with AI.',
    scopes: ['instance'],
  },
  'features.plugins.ai.workflows': {
    label: 'The AI workflow step',
    description: 'The AI workflow node.',
  },
  'usage.plugins.ai.calls': {
    label: 'AI calls',
    description: 'AI calls per period.',
    nouns: ['AI call', 'AI calls'],
  },
  'rateLimits.plugins.ai.calls': { description: 'AI calls per user.' },
  'retention.plugins.ai.generationsDays': { description: 'AI generations.' },
} satisfies PluginControls;
