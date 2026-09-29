import type { FrontendOptions } from '../options.js';

export function manabloxDependencies(options: FrontendOptions): Record<string, string> {
  return {
    '@manablox/live-preview': options.manabloxVersion,
    '@manablox/public-sdk': options.manabloxVersion,
  };
}

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Generates the page interfaces from a running instance's content model. */
function typesScript(options: FrontendOptions): string {
  return `manablox-sdk types --url \${MANABLOX_URL:-${options.url}} --out src/manablox.d.ts`;
}

/** The shared `package.json`; frameworks pass scripts and dependencies. */
export function packageJson(
  options: FrontendOptions,
  parts: {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  },
): string {
  return json({
    name: options.name,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: { ...parts.scripts, types: typesScript(options) },
    dependencies: parts.dependencies,
    devDependencies: parts.devDependencies,
  });
}

/** The `tsconfig.json` of the Vite templates. */
export function tsconfig(parts: {
  target: string;
  jsx?: string;
  types: string[];
  include: string[];
}): string {
  return json({
    compilerOptions: {
      target: parts.target,
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      verbatimModuleSyntax: true,
      ...(parts.jsx ? { jsx: parts.jsx } : {}),
      lib: [parts.target, 'DOM', 'DOM.Iterable'],
      types: parts.types,
    },
    include: parts.include,
  });
}
