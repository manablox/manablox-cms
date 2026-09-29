import { basename, resolve } from 'node:path';
import { booleanFlag, validPort, validUrl } from '../args.js';
import { packageNameFrom, validPackageName } from '../create/options.js';
import { parseTypes, type RenderModel } from './model.js';

const FRAMEWORKS = ['plain', 'astro', 'react-ssr', 'vue-ssr'] as const;

export type Framework = (typeof FRAMEWORKS)[number];

/** One field per command line option. */
export interface FrontendOptions {
  /** Absolute target folder. */
  dir: string;
  /** package.json name. */
  name: string;
  /** `plain` renders in the browser; the others render on the server. */
  framework: Framework;
  /** Delivery API URL. */
  url: string;
  /** Admin origin the preview channel accepts messages from. */
  editorOrigin: string;
  port: number;
  /** Management instances only; a public one pins its space. */
  spaceId: string;
  /** Range for every `@manablox/*` dependency. */
  manabloxVersion: string;
  install: boolean;
  git: boolean;
  force: boolean;
  /** Types to generate components for; `null` writes the example teaser. */
  model: RenderModel | null;
}

export type PartialFrontendOptions = Partial<FrontendOptions>;

/** Where the content model is read from. */
const MODEL_SOURCES = ['management', 'delivery', 'none'] as const;

export type ModelSource = (typeof MODEL_SOURCES)[number];

/** Command line content model options. */
export interface ModelRequest {
  source?: ModelSource;
  /** Management API URL. */
  apiUrl?: string;
  apiKey?: string;
  /** Space id or machine name. */
  space?: string;
  types?: string[] | 'all';
}

/** The dev stack's management API. */
export const DEFAULT_API_URL = 'http://localhost:3000';

/** Distinct per framework so dev servers can run side by side. */
const DEFAULT_PORTS: Record<Framework, number> = {
  plain: 3003,
  astro: 3005,
  'vue-ssr': 3006,
  'react-ssr': 3007,
};

export function defaultFrontendOptions(
  dir: string,
  framework: Framework,
  cliVersion: string,
): FrontendOptions {
  return {
    dir,
    name: packageNameFrom(basename(dir)),
    framework,
    url: 'http://localhost:3100',
    editorOrigin: 'http://localhost:3000',
    port: DEFAULT_PORTS[framework],
    spaceId: '',
    manabloxVersion: `^${cliVersion}`,
    install: true,
    git: true,
    force: false,
    model: null,
  };
}

/** Parses command line options; absent ones stay undefined for the prompts. */
export function frontendOptionsFromArgs(
  options: Record<string, string>,
  flags: Record<string, boolean>,
  positionals: string[],
  cwd: string,
): PartialFrontendOptions {
  const out: PartialFrontendOptions = {};
  const dir = options.dir ?? positionals[0];
  if (dir !== undefined) out.dir = resolve(cwd, dir);

  if (options.name !== undefined) out.name = validPackageName(options.name);
  if (options.framework !== undefined) out.framework = validFramework(options.framework);
  if (options.url !== undefined) out.url = validUrl('url', options.url);
  if (options['editor-origin'] !== undefined) {
    out.editorOrigin = validUrl('editor-origin', options['editor-origin']);
  }
  if (options['space-id'] !== undefined) out.spaceId = options['space-id'].trim();
  if (options.port !== undefined) out.port = validPort('port', options.port);
  if (options['manablox-version'] !== undefined) out.manabloxVersion = options['manablox-version'];

  const install = booleanFlag(flags, 'install');
  if (install !== undefined) out.install = install;
  const git = booleanFlag(flags, 'git');
  if (git !== undefined) out.git = git;
  if (flags.force) out.force = true;

  return out;
}

/** `--model`, else management options imply management and `--types` alone delivery. */
export function modelRequestFromArgs(options: Record<string, string>): ModelRequest {
  const out: ModelRequest = {};
  if (options['api-url'] !== undefined) out.apiUrl = validUrl('api-url', options['api-url']);
  if (options['api-key'] !== undefined) out.apiKey = options['api-key'].trim();
  if (options.space !== undefined) out.space = options.space.trim();
  if (options.types !== undefined) out.types = parseTypes(options.types);

  if (options.model !== undefined) {
    if (!(MODEL_SOURCES as readonly string[]).includes(options.model)) {
      throw new Error(`--model must be one of ${MODEL_SOURCES.join(', ')}, not '${options.model}'`);
    }
    out.source = options.model as ModelSource;
  } else if (out.apiKey !== undefined || out.apiUrl !== undefined || out.space !== undefined) {
    out.source = 'management';
  } else if (out.types !== undefined) {
    out.source = 'delivery';
  }
  return out;
}

function validFramework(value: string): Framework {
  if (!(FRAMEWORKS as readonly string[]).includes(value)) {
    throw new Error(`--framework must be one of ${FRAMEWORKS.join(', ')}, not '${value}'`);
  }
  return value as Framework;
}

/** Display name per framework. */
export const FRAMEWORK_LABELS: Record<Framework, string> = {
  plain: 'Vite + TypeScript',
  astro: 'Astro',
  'react-ssr': 'Vite + React, server-rendered',
  'vue-ssr': 'Vite + Vue, server-rendered',
};
