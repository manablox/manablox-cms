import type { CliTemplateContext, CliTemplates } from '@manablox/core';

const IMPORT = "import { licensePlugin } from '@manablox/plugin-license';";

const PLUGIN = '  licensePlugin(),';

const ENV = `# --- Premium plugin licenses ----------------------------------------------------------
# License keys, comma separated (MBX-XXXXX-...). Keys are secrets: keep them here, never in
# manablox.config.ts. Keys added in the admin (Settings -> Licenses) are stored encrypted in
# the database instead.
MANABLOX_LICENSE_KEYS=
`;

/** The plugin in the management and public configs, and the key list in \`.env\`. */
export function licenseTemplates({ instance }: CliTemplateContext): CliTemplates {
  return {
    dependencies: { '@manablox/plugin-license': instance.manabloxVersion },
    slots: {
      'config.imports': IMPORT,
      'config.plugins': PLUGIN,
      'public.imports': IMPORT,
      'public.plugins': PLUGIN,
      env: ENV,
    },
  };
}
