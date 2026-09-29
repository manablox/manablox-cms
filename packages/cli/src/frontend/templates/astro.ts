import type { ScaffoldFile } from '../../scaffold.js';
import { TYPESCRIPT_FOR, VERSIONS } from '../../versions.js';
import type { FrontendOptions } from '../options.js';
import { templateFiles } from './files.js';
import { json, manabloxDependencies, packageJson } from './shared.js';

/** Astro on Node; the API URL is read at start-up, so one build fits any instance. */
export function astroFiles(options: FrontendOptions): ScaffoldFile[] {
  return [
    ...templateFiles('astro', options),
    // The preview canvas runs in the browser, so it uses the DOM renderers.
    ...templateFiles('shared/dom', options, 'src/lib/preview/'),
    { path: 'package.json', content: pkg(options) },
    { path: 'tsconfig.json', content: tsconfig() },
  ];
}

function pkg(options: FrontendOptions): string {
  return packageJson(options, {
    scripts: {
      dev: 'astro dev',
      build: 'astro build',
      // The Node adapter's standalone entry.
      start: 'node ./dist/server/entry.mjs',
      preview: 'astro preview',
      typecheck: 'astro check',
    },
    dependencies: {
      '@astrojs/node': VERSIONS['@astrojs/node'],
      ...manabloxDependencies(options),
      astro: VERSIONS.astro,
    },
    devDependencies: {
      '@astrojs/check': VERSIONS['@astrojs/check'],
      // `src/lib/manablox.ts` reads `process.env`.
      '@types/node': VERSIONS['@types/node'],
      typescript: TYPESCRIPT_FOR.astro,
    },
  });
}

/** Astro's own strict config. */
function tsconfig(): string {
  return json({
    extends: 'astro/tsconfigs/strict',
    include: ['.astro/types.d.ts', '**/*'],
    exclude: ['dist'],
  });
}
