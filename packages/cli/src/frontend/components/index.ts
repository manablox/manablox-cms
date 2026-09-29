import type { ScaffoldFile } from '../../scaffold.js';
import type { RenderModel } from '../model.js';
import type { Framework, FrontendOptions } from '../options.js';
import { templateFile } from '../templates/files.js';
import { astroComponents } from './astro.js';
import { nameTypes } from './codegen-common.js';
import { domFiles } from './dom.js';
import { reactComponents } from './react.js';
import { vueComponents } from './vue.js';

/** Generated components per framework and the template files they replace. */
function componentFiles(
  framework: Framework,
  model: RenderModel,
  options: FrontendOptions,
): { files: ScaffoldFile[]; drop: string[] } {
  const named = nameTypes(model);
  switch (framework) {
    case 'plain':
      return {
        files: [
          ...domFiles(named, { root: 'src', fields: '../fields.js' }),
          { path: 'src/fields.ts', content: templateFile('shared/fields.ts', options) },
        ],
        drop: ['src/blocks/teaser.ts'],
      };
    case 'astro':
      return {
        files: [
          ...astroComponents(named),
          ...domFiles(named, { root: 'src/lib/preview', fields: '../../fields.js' }),
          { path: 'src/lib/fields.ts', content: templateFile('shared/fields.ts', options) },
        ],
        drop: ['src/components/blocks/Teaser.astro', 'src/lib/preview/blocks/teaser.ts'],
      };
    case 'react-ssr':
      return {
        files: [
          ...reactComponents(named),
          { path: 'src/lib/fields.ts', content: templateFile('shared/fields.ts', options) },
        ],
        drop: ['src/components/blocks/Teaser.tsx'],
      };
    case 'vue-ssr':
      return {
        files: [
          ...vueComponents(named),
          { path: 'src/lib/fields.ts', content: templateFile('shared/fields.ts', options) },
        ],
        drop: ['src/components/blocks/Teaser.vue'],
      };
  }
}

/** Template files with the generated ones swapped in. */
export function withComponents(files: ScaffoldFile[], options: FrontendOptions): ScaffoldFile[] {
  if (!options.model) return files;
  const generated = componentFiles(options.framework, options.model, options);
  const replaced = new Set([...generated.drop, ...generated.files.map((file) => file.path)]);
  return [...files.filter((file) => !replaced.has(file.path)), ...generated.files];
}
