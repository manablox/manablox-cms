import type { ScaffoldFile } from '../../scaffold.js';
import { VERSIONS } from '../../versions.js';
import type { FrontendOptions } from '../options.js';
import { templateFile, templateFiles } from './files.js';
import { manabloxDependencies, packageJson, tsconfig } from './shared.js';

/** Vite without a framework, rendered in the browser; `.env` is inlined at build time. */
export function plainFiles(options: FrontendOptions): ScaffoldFile[] {
  return [
    ...templateFiles('plain', options),
    // Shared with Astro's preview canvas.
    ...templateFiles('shared/dom', options, 'src/'),
    { path: 'src/style.css', content: templateFile('shared/style.css', options) },
    { path: 'package.json', content: pkg(options) },
    {
      path: 'tsconfig.json',
      content: tsconfig({ target: 'ES2023', types: [], include: ['src', 'vite.config.ts'] }),
    },
  ];
}

function pkg(options: FrontendOptions): string {
  return packageJson(options, {
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
      typecheck: 'tsc --noEmit',
    },
    dependencies: manabloxDependencies(options),
    devDependencies: {
      typescript: VERSIONS.typescript,
      vite: VERSIONS.vite,
    },
  });
}
