import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { ScaffoldFile } from '../../scaffold.js';
import { fill, renderTemplate, templatesRoot } from '../../template-files.js';
import { quote } from '../components/codegen-common.js';
import { expandFor } from '../model.js';
import type { FrontendOptions } from '../options.js';

/** Reads scaffold files from `templates/` and fills their `__TOKEN__`s. */

function tokens(options: FrontendOptions): Record<string, string> {
  return {
    __MANABLOX_URL__: options.url,
    __EDITOR_ORIGIN__: options.editorOrigin,
    __PORT__: String(options.port),
    __NAME__: options.name,
    // Relations to inline: the teaser's image, or every relation the generated components show.
    __EXPAND__: `[${(options.model ? expandFor(options.model) : ['image']).map(quote).join(', ')}]`,
  };
}

/** One template with its tokens filled; `extra` adds per-framework tokens. */
export function templateFile(
  path: string,
  options: FrontendOptions,
  extra: Record<string, string> = {},
): string {
  return renderTemplate(path, { ...tokens(options), ...extra });
}

/** A `frontend-common/` file, filled with the framework's flags; `extra` adds tokens. */
export function commonFile(
  name: string,
  options: FrontendOptions,
  extra: Record<string, string>,
): string {
  const framework = options.framework;
  const model = options.model;
  return renderTemplate(
    `frontend-common/${name}`,
    {
      ...tokens(options),
      ...extra,
      __ENV_PREFIX__: framework === 'plain' ? 'VITE_' : '',
      __SPACE_ID__: options.spaceId,
      // Last: type labels are user text.
      __MODEL_TYPES__: (model?.types ?? [])
        .map(
          (type) =>
            `- \`${type.name}\` (${type.kind}) - ${type.label}, ${type.fields.length} field(s)`,
        )
        .join('\n'),
    },
    {
      plain: framework === 'plain',
      astro: framework === 'astro',
      reactSsr: framework === 'react-ssr',
      vueSsr: framework === 'vue-ssr',
      ssr: framework === 'react-ssr' || framework === 'vue-ssr',
      model: model !== null,
    },
  );
}

/** Every file under a template directory, filled; `into` prefixes the output paths. */
export function templateFiles(
  directory: string,
  options: FrontendOptions,
  into = '',
): ScaffoldFile[] {
  const base = join(templatesRoot(), directory);
  const values = tokens(options);
  return walk(base).map((path) => ({
    // Always `/`, whatever the platform.
    path: into + path.split(sep).join('/'),
    content: fill(readFileSync(join(base, path), 'utf8'), values),
  }));
}

/** Relative paths of every file under a directory. */
function walk(base: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(base, prefix), { withFileTypes: true })) {
    const path = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...walk(base, path));
    else out.push(path);
  }
  return out;
}
