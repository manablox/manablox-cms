import type { ScaffoldFile } from '../../scaffold.js';
import { withComponents } from '../components/index.js';
import { FRAMEWORK_LABELS, type Framework, type FrontendOptions } from '../options.js';
import { astroFiles } from './astro.js';
import { commonFile } from './files.js';
import { plainFiles } from './plain.js';
import { reactSsrFiles } from './react-ssr.js';
import { vueSsrFiles } from './vue-ssr.js';

const RENDERERS: Record<Framework, (options: FrontendOptions) => ScaffoldFile[]> = {
  plain: plainFiles,
  astro: astroFiles,
  'react-ssr': reactSsrFiles,
  'vue-ssr': vueSsrFiles,
};

/** Renders every file of a new frontend; pure. */
export function renderFrontendFiles(options: FrontendOptions): ScaffoldFile[] {
  const run = commands(options);
  const common = (name: string) =>
    commonFile(name, options, {
      __FRAMEWORK_LABEL__: FRAMEWORK_LABELS[options.framework],
      __DEV__: run.dev,
      __BUILD__: run.build,
      __START__: run.start,
    });
  const files = [
    ...withComponents(RENDERERS[options.framework](options), options),
    { path: '.gitignore', content: common('gitignore') },
    { path: 'pnpm-workspace.yaml', content: common('pnpm-workspace.yaml') },
    { path: '.env.example', content: common('env') },
    { path: '.env', content: common('env') },
    { path: 'README.md', content: common('README.md') },
  ];
  // Code point order is locale independent.
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** Dev, build and start commands per framework. */
export function commands(options: FrontendOptions): { dev: string; build: string; start: string } {
  return {
    dev: 'pnpm dev',
    build: 'pnpm build',
    start: options.framework === 'plain' ? 'pnpm preview' : 'pnpm start',
  };
}
