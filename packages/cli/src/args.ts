import { type ParseArgsOptionsConfig, parseArgs as parseArgv } from 'node:util';
import type { CliOption, CliValues } from '@manablox/core';
import { type CliPlugin, FIRST_PARTY_PLUGINS } from './plugins.js';

export interface ParsedArgs {
  command: string | undefined;
  /** Arguments after the command. */
  positionals: string[];
  options: Record<string, string>;
  /** Repeatable options, in the order given. */
  lists: Record<string, string[]>;
  flags: Record<string, boolean>;
  help: boolean;
  raw: string[];
}

/** Options with a value and switches per command; `--no-x` forms are listed explicitly. */
interface CommandOptions {
  values: readonly string[];
  switches: readonly string[];
  /** Options that may be given more than once. */
  lists?: readonly string[];
}

const negatable = (names: readonly string[]) => names.flatMap((name) => [name, `no-${name}`]);

const COMMAND_OPTIONS: Record<string, CommandOptions> = {
  start: { values: ['config', 'mode', 'port', 'host'], switches: ['watch'] },
  migrate: { values: ['config'], switches: [] },
  'migrate-db': { values: ['config', 'to', 'app-role'], switches: ['replace', 'force-offline'] },
  backup: { values: ['config'], switches: [] },
  sync: { values: ['config', 'space'], switches: ['dry-run', 'prune'] },
  'push-keys': { values: [], switches: [] },
  docs: { values: ['config', 'out'], switches: [] },
  space: {
    values: [
      'config',
      'name',
      'machine-name',
      'url',
      'locales',
      'template',
      'blocks',
      'owner',
      'plan',
    ],
    switches: negatable(['starter']),
    lists: ['plugin-data'],
  },
  user: { values: ['config', 'email', 'name', 'role'], switches: [] },
  create: {
    values: [
      'dir',
      'name',
      'preset',
      'proxy',
      'database',
      'admin-domain',
      'public-domain',
      'acme-email',
      'admin-port',
      'public-port',
      'postgres-port',
      'valkey-port',
      'storage',
      'mail',
      'manablox-version',
      'admin-email',
      'admin-name',
      'space-name',
      'space-url',
      'space-locales',
      'space-template',
      'space-blocks',
      'features',
    ],
    switches: [
      ...negatable(['public', 'admin', 'space', 'space-starter', 'install', 'git', 'start']),
      // The first-party plugins, also where one is not installed.
      ...negatable(FIRST_PARTY_PLUGINS.map((plugin) => plugin.id)),
      'force',
      'yes',
    ],
  },
  plugin: {
    values: ['config', 'space'],
    switches: [...negatable(['install', 'migrate']), 'strict', 'yes'],
  },
  frontend: {
    values: [
      'framework',
      'url',
      'editor-origin',
      'space-id',
      'port',
      'model',
      'api-url',
      'api-key',
      'types',
      'dir',
      'name',
      'space',
      'manablox-version',
    ],
    switches: [...negatable(['install', 'git']), 'force', 'yes'],
  },
};

function optionTable(commands: CommandOptions[]): ParseArgsOptionsConfig {
  const table: ParseArgsOptionsConfig = { help: { type: 'boolean', short: 'h' } };
  for (const { values, switches, lists = [] } of commands) {
    for (const name of values) table[name] = { type: 'string' };
    for (const name of switches) table[name] = { type: 'boolean' };
    for (const name of lists) table[name] = { type: 'string', multiple: true };
  }
  return table;
}

/** Every command's options, to find the command and to parse without one. */
const ALL_OPTIONS = optionTable(Object.values(COMMAND_OPTIONS));

/** The command word and `--config`, read without knowing the plugins' options. */
export function peekArgs(argv: string[]): {
  command: string | undefined;
  config?: string;
  /** `create --features`. */
  features?: string;
  help: boolean;
} {
  const { values, positionals } = parseArgv({
    args: argv,
    options: ALL_OPTIONS,
    strict: false,
    allowPositionals: true,
  });
  return {
    command: positionals[0],
    ...(typeof values.config === 'string' ? { config: values.config } : {}),
    ...(typeof values.features === 'string' ? { features: values.features } : {}),
    help: values.help === true,
  };
}

/**
 * Whether `argv` holds an option the core does not give `command`, e.g. a plugin's `create`
 * option handed to `manablox plugin install`.
 */
export function foreignOptions(argv: string[], command: string): boolean {
  const core = COMMAND_OPTIONS[command];
  if (!core) return false;
  const known = optionTable([core]);
  const { tokens } = parseArgv({
    args: argv,
    options: known,
    strict: false,
    allowPositionals: true,
    tokens: true,
  });
  return tokens.some((token) => token.kind === 'option' && !(token.name in known));
}

/** The options given that the core does not give `command`, by name (`--no-x` as `x`). */
export function optionsBeyondCore(
  args: Pick<ParsedArgs, 'options' | 'flags' | 'lists'>,
  command: string,
): string[] {
  const core = COMMAND_OPTIONS[command];
  const known = new Set([
    ...(core?.values ?? []),
    ...(core?.switches ?? []),
    ...(core?.lists ?? []),
  ]);
  const names = [
    ...Object.keys(args.options),
    ...Object.keys(args.lists),
    ...Object.keys(args.flags).map((name) =>
      !known.has(name) && name.startsWith('no-') ? name.slice(3) : name,
    ),
  ];
  return [...new Set(names.filter((name) => !known.has(name)))];
}

/** A plugin option's names for the parser. */
function pluginOptions(options: readonly CliOption[]): CommandOptions {
  const pick = (type: CliOption['type']) =>
    options.filter((option) => (option.type ?? 'value') === type).map((option) => option.name);
  return { values: pick('value'), switches: negatable(pick('switch')), lists: pick('list') };
}

/** The plugins' options of a command, added to the core's; a name used twice throws. */
function commandOptions(
  command: string,
  plugins: readonly CliPlugin[],
): CommandOptions | undefined {
  const core = COMMAND_OPTIONS[command];
  const plugin = core
    ? undefined
    : plugins.find((entry) => entry.id === command && entry.contribution.commands);
  if (!core && !plugin) return undefined;
  const parts: Array<{ owner: string; options: CommandOptions }> = [];
  if (core) parts.push({ owner: 'the core', options: core });
  if (plugin) {
    const all = Object.values(plugin.contribution.commands ?? {}).flatMap(
      (entry) => entry.options ?? [],
    );
    const seen = new Map(all.map((option) => [option.name, option]));
    parts.push({ owner: 'the core', options: { values: ['config'], switches: ['yes'] } });
    parts.push({ owner: `the ${plugin.id} plugin`, options: pluginOptions([...seen.values()]) });
  }
  // `plugin install` takes the `create` options of the plugins it installs.
  const seen = new Set<string>();
  for (const entry of plugins) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const group =
      command === 'space'
        ? entry.contribution.options?.['space create']
        : command === 'create' || command === 'plugin'
          ? entry.contribution.options?.create
          : undefined;
    if (!group) continue;
    const owner = `the ${entry.id} plugin`;
    parts.push({ owner, options: pluginOptions(group.options) });
  }
  const owners = new Map<string, string>();
  const merged = { values: [] as string[], switches: [] as string[], lists: [] as string[] };
  for (const { owner, options } of parts) {
    for (const [kind, names] of [
      ['values', options.values],
      ['switches', options.switches],
      ['lists', options.lists ?? []],
    ] as const) {
      for (const name of names) {
        const taken = owners.get(name);
        if (taken && !(taken === owner && owner === 'the core')) {
          throw new Error(`${owner} adds --${name} to '${command}', which ${taken} has already`);
        }
        owners.set(name, owner);
        merged[kind].push(name);
      }
    }
  }
  return merged;
}

/** Parses `argv` strictly, with the options the plugins add to the command. */
export function parseArgs(argv: string[], plugins: readonly CliPlugin[] = []): ParsedArgs {
  const { command } = peekArgs(argv);
  const known = command ? commandOptions(command, plugins) : undefined;
  const options = known ? optionTable([known]) : ALL_OPTIONS;

  let parsed: ReturnType<typeof parseArgv>;
  try {
    parsed = parseArgv({ args: argv, options, strict: true, allowPositionals: true });
  } catch (error) {
    const message = String((error as { message?: unknown })?.message ?? error);
    const option = /Unknown option '([^']+)'/.exec(message)?.[1];
    const where = known ? ` for '${command}'` : '';
    const reason = option ? `unknown option '${option}'${where}` : message.split('\n')[0];
    throw new Error(`${reason}; see manablox --help`);
  }

  const result: ParsedArgs = {
    command: parsed.positionals[0],
    positionals: parsed.positionals.slice(1),
    options: {},
    lists: {},
    flags: {},
    help: parsed.values.help === true,
    raw: argv,
  };
  for (const [name, value] of Object.entries(parsed.values)) {
    if (name === 'help') continue;
    if (typeof value === 'string') result.options[name] = value;
    else if (Array.isArray(value)) result.lists[name] = value.map(String);
    else if (value === true) result.flags[name] = true;
  }
  return result;
}

/** The given values of a plugin's options. */
export function optionValues(
  args: Pick<ParsedArgs, 'options' | 'flags' | 'lists'>,
  options: readonly CliOption[],
): CliValues {
  const values: CliValues = {};
  for (const option of options) {
    const type = option.type ?? 'value';
    const value =
      type === 'value'
        ? args.options[option.name]
        : type === 'list'
          ? args.lists[option.name]
          : booleanFlag(args.flags, option.name);
    if (value !== undefined) values[option.name] = value;
  }
  return values;
}

/** `--x` is true, `--no-x` false, neither undefined. */
export function booleanFlag(flags: Record<string, boolean>, name: string): boolean | undefined {
  if (flags[`no-${name}`]) return false;
  if (flags[name]) return true;
  return undefined;
}

export function oneOf<T extends string>(option: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`--${option} must be one of ${allowed.join(', ')}, not '${value}'`);
  }
  return value as T;
}

export function validPort(option: string, value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--${option} '${value}' is not a port`);
  }
  return port;
}

export function validDomain(option: string, value: string): string {
  const host = value.replace(/^http:\/\//, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i.test(host)) {
    throw new Error(`--${option} '${value}' is not a host name (optionally prefixed with http://)`);
  }
  return value;
}

export function validEmail(option: string, value: string): string {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`--${option} '${value}' is not an email address`);
  }
  return value;
}

/** Absolute `http(s)` URL without a trailing slash. */
export function validUrl(option: string, value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`--${option} '${value}' is not a URL (http://localhost:3100)`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`--${option} '${value}' must be an http:// or https:// URL`);
  }
  return parsed.origin + parsed.pathname.replace(/\/$/, '');
}
