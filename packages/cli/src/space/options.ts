import {
  SPACE_BLOCK_IDS,
  SPACE_TEMPLATE_IDS,
  type SpaceBlockId,
  type SpaceTemplateId,
  technicalName,
} from '@manablox/core';
import { booleanFlag, oneOf, validEmail, validUrl } from '../args.js';

/** What `manablox space create` writes. */
export interface SpaceOptions {
  name: string;
  /** Lower case, letter first; keys the GraphQL schema and the public instance's pin. */
  machineName: string;
  /** The website's address. */
  url: string;
  /** The first one is the default locale. */
  locales: string[];
  /** The website type it starts with: a content model, published pages and a main menu. */
  starter: SpaceTemplateId | null;
  /** The sections of the `custom` type; `null` takes its defaults. */
  blocks?: SpaceBlockId[] | null | undefined;
  /** The owning account's email; none leaves the space to the first account. */
  owner?: string | undefined;
  /** Data for plugins that take part in creating spaces, by plugin id. */
  pluginData?: Record<string, unknown> | undefined;
  /** A JSON file with a content type plan, applied after the starter. */
  plan?: string | undefined;
  /** Plugin options, passed through as given. */
  extraArgs?: string[] | undefined;
}

/** The default website address. */
const DEFAULT_SPACE_URL = 'http://localhost:3200';

/** Comma separated catalog blocks, e.g. `hero,text,gallery`. */
function validBlocks(option: string, value: string): SpaceBlockId[] {
  const blocks = [
    ...new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
  if (!blocks.length) throw new Error(`--${option} needs at least one block`);
  return blocks.map((entry) => oneOf(option, entry, SPACE_BLOCK_IDS));
}

/** `--blocks` picks the sections of the `custom` type and implies it. */
export function blocksFor(
  option: string,
  starter: SpaceTemplateId | null | undefined,
  value: string | undefined,
): { starter: SpaceTemplateId | null | undefined; blocks: SpaceBlockId[] | null } {
  if (value === undefined) return { starter, blocks: null };
  if (starter !== undefined && starter !== 'custom')
    throw new Error(`--${option} picks the sections of the custom type; drop it or use custom`);
  return { starter: 'custom', blocks: validBlocks(option, value) };
}

/** A machine name from a display name, as the admin derives it. */
export function machineNameFrom(name: string): string {
  return technicalName(name, { final: true }) || 'site';
}

function validMachineName(option: string, value: string): string {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value)) {
    throw new Error(
      `--${option} '${value}' is not a technical name (a lowercase letter, then letters, digits, '-' or '_')`,
    );
  }
  return value;
}

/** Comma separated locale codes, e.g. `en,de`; the first is the default. */
export function validLocales(option: string, value: string): string[] {
  const locales = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const bad = locales.find((entry) => !/^[a-z]{2,3}([-_][a-z0-9]{2,8})*$/i.test(entry));
  if (!locales.length || bad !== undefined) {
    throw new Error(`--${option} '${value}' is not a comma separated list of locales (en,de)`);
  }
  return [...new Set(locales)];
}

/** `--template` wins; `--starter` is the basic template, `--no-starter` none. */
export function starterFrom(
  option: string,
  template: string | undefined,
  starter: boolean | undefined,
): SpaceTemplateId | null | undefined {
  if (template !== undefined) return oneOf(option, template, SPACE_TEMPLATE_IDS);
  return starter === undefined ? undefined : starter ? 'basic' : null;
}

export function validSpaceName(option: string, value: string): string {
  const name = value.trim();
  if (!name || name.length > 200)
    throw new Error(`--${option} needs a name of 1 to 200 characters`);
  return name;
}

/** `<id>=<json>` entries, e.g. `hello={"greeting":"Hi"}`, by plugin id. */
function validPluginData(
  option: string,
  entries: readonly string[],
): Record<string, unknown> | undefined {
  if (!entries.length) return undefined;
  const data: Record<string, unknown> = {};
  for (const entry of entries) {
    const split = entry.indexOf('=');
    const id = entry.slice(0, Math.max(split, 0)).trim();
    if (split < 0 || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(id)) {
      throw new Error(`--${option} '${entry}' is not <plugin id>=<json>`);
    }
    if (Object.hasOwn(data, id)) throw new Error(`--${option} names the plugin '${id}' twice`);
    try {
      data[id] = JSON.parse(entry.slice(split + 1));
    } catch {
      throw new Error(`--${option} for '${id}' is not JSON: ${entry.slice(split + 1)}`);
    }
  }
  return data;
}

/** `manablox space create` options; the name is required. */
export function spaceOptionsFromArgs(
  options: Record<string, string>,
  flags: Record<string, boolean>,
  lists: Record<string, string[]> = {},
): SpaceOptions {
  if (options.name === undefined) throw new Error('--name is required; see manablox --help');
  const name = validSpaceName('name', options.name);
  const pluginData = validPluginData('plugin-data', lists['plugin-data'] ?? []);
  const picked = blocksFor(
    'blocks',
    starterFrom('template', options.template, booleanFlag(flags, 'starter')),
    options.blocks,
  );
  return {
    name,
    machineName: validMachineName('machine-name', options['machine-name'] ?? machineNameFrom(name)),
    url: validUrl('url', options.url ?? DEFAULT_SPACE_URL),
    locales: validLocales('locales', options.locales ?? 'en'),
    starter: picked.starter ?? null,
    ...(picked.blocks ? { blocks: picked.blocks } : {}),
    owner:
      options.owner === undefined
        ? undefined
        : validEmail('owner', options.owner.trim().toLowerCase()),
    ...(pluginData ? { pluginData } : {}),
    ...(options.plan !== undefined ? { plan: options.plan } : {}),
  };
}

/** The arguments of `manablox space create` for these options, quoted for a shell where needed. */
export function spaceCreateArgs(space: SpaceOptions): string[] {
  const args = [
    'space',
    'create',
    '--name',
    space.name,
    '--machine-name',
    space.machineName,
    '--url',
    space.url,
  ];
  if (space.locales.join(',') !== 'en') args.push('--locales', space.locales.join(','));
  if (space.starter) args.push('--template', space.starter);
  if (space.starter === 'custom' && space.blocks?.length)
    args.push('--blocks', space.blocks.join(','));
  if (space.extraArgs) args.push(...space.extraArgs);
  if (space.plan) args.push('--plan', space.plan);
  if (space.owner) args.push('--owner', space.owner);
  for (const [id, data] of Object.entries(space.pluginData ?? {})) {
    args.push('--plugin-data', `${id}=${JSON.stringify(data)}`);
  }
  return args;
}

/** One argument as a POSIX shell word. */
export function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}
