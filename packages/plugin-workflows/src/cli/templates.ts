import type { CliTemplateContext, CliTemplates } from '@manablox/core';

const IMPORT = "import { workflowsPlugin } from '@manablox/plugin-workflows';";

const PLUGIN = '  workflowsPlugin(),';

/** The plugin in the management config. */
export function workflowsTemplates({ instance }: CliTemplateContext): CliTemplates {
  return {
    dependencies: { '@manablox/plugin-workflows': instance.manabloxVersion },
    slots: { 'config.imports': IMPORT, 'config.plugins': PLUGIN },
  };
}
