import { defineCliContribution } from '@manablox/core';

/** Stands in for `@manablox/plugin-ai/cli`: a plugin in the configs with a line in `.env`. */
export default defineCliContribution({
  summary: 'a stand-in for the AI plugin',
  templates: ({ instance }) => ({
    dependencies: { '@manablox/plugin-ai': instance.manabloxVersion },
    slots: {
      'config.imports': "import { aiPlugin } from '@manablox/plugin-ai';",
      'config.plugins':
        "  // Private-network hosts a self-hosted AI provider may reach, as `host` or `host:port`.\n  aiPlugin({ allowedHosts: envList('AI_ALLOWED_HOSTS', []) }),",
      env: '# Private-network hosts a self-hosted AI provider may reach.\nAI_ALLOWED_HOSTS=\n',
    },
  }),
});
