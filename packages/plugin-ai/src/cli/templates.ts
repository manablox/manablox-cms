import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliTemplateContext, CliTemplates } from '@manablox/core';

/** The fragment files: beside this module in the sources, under `cli/templates` in the build. */
function templatesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const found = [join(here, 'templates'), join(here, 'cli', 'templates')].find((dir) =>
    existsSync(join(dir, 'env')),
  );
  if (!found) throw new Error('the AI plugin is missing its CLI templates');
  return found;
}

const IMPORT = "import { aiPlugin } from '@manablox/plugin-ai';";

const PLUGIN = `  // Private-network hosts a self-hosted AI provider may reach, as \`host\` or \`host:port\`.
  aiPlugin({ allowedHosts: envList('AI_ALLOWED_HOSTS', []) }),`;

/** The plugin in the management config and its line in `.env`. */
export function aiTemplates({ instance }: CliTemplateContext): CliTemplates {
  return {
    dependencies: { '@manablox/plugin-ai': instance.manabloxVersion },
    slots: {
      'config.imports': IMPORT,
      'config.plugins': PLUGIN,
      env: readFileSync(join(templatesDir(), 'env'), 'utf8'),
    },
  };
}
