import type { ScaffoldFile } from '../../scaffold.js';
import { VERSIONS } from '../../versions.js';
import type { FrontendOptions } from '../options.js';
import { templateFile, templateFiles } from './files.js';
import { manabloxDependencies, packageJson, tsconfig } from './shared.js';

/** Vite and React with SSR and hydration; built once for the browser, once for the server. */
export function reactSsrFiles(options: FrontendOptions): ScaffoldFile[] {
  return [
    ...templateFiles('react-ssr', options),
    { path: 'src/style.css', content: templateFile('shared/style.css', options) },
    {
      path: 'server.js',
      // The only difference from the Vue server.
      content: templateFile('shared/server.js', options, {
        __SERVER_ENTRY__: '/src/entry-server.tsx',
      }),
    },
    { path: 'package.json', content: pkg(options) },
    {
      path: 'tsconfig.json',
      content: tsconfig({
        target: 'ES2022',
        jsx: 'react-jsx',
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
      'build:client': 'NODE_ENV=production vite build --outDir dist/client',
      // Without `NODE_ENV` the SSR bundle imports React's dev JSX runtime.
      'build:server':
        'NODE_ENV=production vite build --ssr src/entry-server.tsx --outDir dist/server',
      start: 'NODE_ENV=production node server.js',
      typecheck: 'tsc --noEmit',
    },
    dependencies: {
      ...manabloxDependencies(options),
      express: VERSIONS.express,
      react: VERSIONS.react,
      'react-dom': VERSIONS['react-dom'],
    },
    devDependencies: {
      '@types/express': VERSIONS['@types/express'],
      '@types/node': VERSIONS['@types/node'],
      '@types/react': VERSIONS['@types/react'],
      '@types/react-dom': VERSIONS['@types/react-dom'],
      '@vitejs/plugin-react': VERSIONS['@vitejs/plugin-react'],
      typescript: VERSIONS.typescript,
      vite: VERSIONS.vite,
    },
  });
}
