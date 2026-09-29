import type { CliTemplateContext, CliTemplates } from '@manablox/core';

const IMPORT = "import { webhooksPlugin } from '@manablox/plugin-webhooks';";

const PLUGIN = '  webhooksPlugin(),';

/** The plugin in the management config. */
export function webhooksTemplates({ instance }: CliTemplateContext): CliTemplates {
  return {
    dependencies: { '@manablox/plugin-webhooks': instance.manabloxVersion },
    slots: { 'config.imports': IMPORT, 'config.plugins': PLUGIN },
  };
}
