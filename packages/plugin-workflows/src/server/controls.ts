import type { PluginControls } from '@manablox/core';

/**
 * Features, the active limit, run usage, rates and retention under `plugins.workflows`; the
 * plugin's flag is workflows themselves.
 */
export const workflowControls = {
  'features.plugins.workflows.http': {
    label: 'HTTP and crawl nodes',
    description: 'The HTTP and crawl workflow nodes.',
  },
  'features.plugins.workflows.mail': {
    label: 'Mail nodes',
    description: 'The mail workflow nodes.',
  },
  'limits.plugins.workflows.active': {
    label: 'Active workflows',
    description: 'Enabled workflows.',
    nouns: ['active workflow', 'active workflows'],
  },
  'usage.plugins.workflows.runs': {
    label: 'Workflow runs',
    description: 'Workflow runs per period, test runs excluded.',
    nouns: ['workflow run', 'workflow runs'],
  },
  'rateLimits.plugins.workflows.concurrency': {
    description: 'Workflow runs at once per scope.',
    concurrency: true,
  },
  'rateLimits.plugins.workflows.starts': { description: 'Workflow starts per space.' },
  'retention.plugins.workflows.runsDays': {
    description: 'Workflow runs (the newest 200 stay the ceiling).',
  },
} satisfies PluginControls;
