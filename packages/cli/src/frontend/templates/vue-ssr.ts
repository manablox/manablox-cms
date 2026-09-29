import type { ScaffoldFile } from '../../scaffold.js';
import { TYPESCRIPT_FOR, VERSIONS } from '../../versions.js';
import type { FrontendOptions } from '../options.js';
import { templateFile, templateFiles } from './files.js';
import { manabloxDependencies, packageJson, tsconfig } from './shared.js';

/** Vite and Vue with SSR and hydration, sharing the React template's server. */
export function vueSsrFiles(options: FrontendOptions): ScaffoldFile[] {
  return [
    ...templateFiles('vue-ssr', options),
    { path: 'src/style.css', content: templateFile('shared/style.css', options) },
    {
      path: 'server.js',
      // The only difference from the React server.
      content: templateFile('shared/server.js', options, {
        __SERVER_ENTRY__: '/src/entry-server.ts',
      }),
    },
    { path: 'package.json', content: pkg(options) },
    {
      path: 'tsconfig.json',
      content: tsconfig({
        target: 'ES2022',
        jsx: 'preserve',
        types: ['vite/client', 'node'],
        include: ['src', 'server.js', 'vite.config.ts'],
      }),
    },
  ];
}

function pkg(options: FrontendOptions): string {
  return packageJson(options, {
    scripts: {
      dev: 'node server.js',
      build: 'pnpm build:client && pnpm build:server',
      'build:client': 'vite build --outDir dist/client',
      'build:server': 'vite build --ssr src/entry-server.ts --outDir dist/server',
      start: 'NODE_ENV=production node server.js',
      typecheck: 'vue-tsc --noEmit',
    },
    dependencies: {
      ...manabloxDependencies(options),
      express: VERSIONS.express,
      vue: VERSIONS.vue,
      'vue-router': VERSIONS['vue-router'],
    },
    devDependencies: {
      '@types/express': VERSIONS['@types/express'],
      '@types/node': VERSIONS['@types/node'],
      '@vitejs/plugin-vue': VERSIONS['@vitejs/plugin-vue'],
      typescript: TYPESCRIPT_FOR.vue,
      vite: VERSIONS.vite,
      'vue-tsc': VERSIONS['vue-tsc'],
    },
  });
}
