import { basename, resolve } from 'node:path';
import {
  MAIL_DRIVERS,
  type MailDriver,
  type SpaceBlockId,
  type SpaceTemplateId,
} from '@manablox/core';
import { booleanFlag, oneOf, validDomain, validEmail, validPort, validUrl } from '../args.js';
import { FIRST_PARTY_PLUGINS } from '../plugins.js';
import {
  blocksFor,
  machineNameFrom,
  type SpaceOptions,
  starterFrom,
  validLocales,
  validSpaceName,
} from '../space/options.js';
import { validUserName } from '../user/options.js';

/** A mail driver, or `none`. */
export type MailChoice = MailDriver | 'none';

const MAIL_CHOICES: readonly MailChoice[] = [...MAIL_DRIVERS, 'none'];

/** Mailpit for local, none for docker so the stack boots without an API key. */
export function defaultMail(preset: CreateOptions['preset']): MailChoice {
  return preset === 'local' ? 'mailpit' : 'none';
}

/** One field per command line option. */
export interface CreateOptions {
  /** Absolute target folder. */
  dir: string;
  /** package.json name and compose project name. */
  name: string;
  /** `local` runs only Postgres and Valkey in Docker. */
  preset: 'local' | 'docker';
  /** Docker only: Caddy (automatic TLS), nginx (own certificates) or none (ports published). */
  proxy: 'caddy' | 'nginx' | 'none';
  /** `sqlite` keeps the database in one file and needs no database server. */
  database: 'postgres' | 'sqlite';
  /** Adds the hardened public delivery instance with a read-only database role. */
  publicApi: boolean;
  /** Whether each first-party plugin is included, by plugin id; none is by default. */
  plugins: Record<string, boolean>;
  /** Caddy and nginx host names; an `http://` prefix disables TLS. */
  adminDomain: string;
  publicDomain: string;
  acmeEmail: string;
  /** Without Caddy: listen (and published) ports. */
  adminPort: number;
  publicPort: number;
  /** Local preset: published service ports. */
  postgresPort: number;
  valkeyPort: number;
  storage: 'local' | 's3';
  mail: MailChoice;
  /** Creates the first account, a superadmin, once the instance runs, or lists the command. */
  admin: boolean;
  adminEmail: string;
  adminName: string;
  /** Only for the start steps, never written to a file; empty until asked, read or generated. */
  adminPassword: string;
  /** Creates a first space once the instance runs, or lists the command in the next steps. */
  space: boolean;
  spaceName: string;
  /** Empty until `finalizeOptions` fills in the default. */
  spaceUrl: string;
  spaceLocales: string[];
  spaceStarter: SpaceTemplateId | null;
  /** The sections of the `custom` type; `null` takes its defaults. */
  spaceBlocks?: SpaceBlockId[] | null | undefined;
  /** The plugins' arguments for the first space's `manablox space create`. */
  spaceArgs: string[];
  /** The plugins' default for `spaceUrl`. */
  pluginSpaceUrl?: string | undefined;
  /** Range for every `@manablox/*` dependency. */
  manabloxVersion: string;
  install: boolean;
  git: boolean;
  /** Start the instance after installing. */
  start: boolean;
  /** Write into a non-empty folder. */
  force: boolean;
}

export type PartialOptions = Partial<CreateOptions>;

/** Defaults for a local trial that runs without edits: the core alone, or the `picked` plugins. */
export function defaultOptions(
  dir: string,
  cliVersion: string,
  picked: readonly string[] = [],
): CreateOptions {
  const preset = 'local';
  return {
    dir,
    name: packageNameFrom(basename(dir)),
    preset,
    // Applies once the docker preset is picked.
    proxy: 'caddy',
    database: 'postgres',
    publicApi: true,
    plugins: Object.fromEntries(
      FIRST_PARTY_PLUGINS.map((plugin) => [plugin.id, picked.includes(plugin.id)]),
    ),
    adminDomain: 'cms.example.com',
    publicDomain: 'content.example.com',
    acmeEmail: 'ops@example.com',
    adminPort: 3000,
    publicPort: 3100,
    postgresPort: 5432,
    valkeyPort: 6379,
    storage: 'local',
    mail: defaultMail(preset),
    admin: true,
    adminEmail: 'admin@example.com',
    adminName: 'Administrator',
    adminPassword: '',
    space: true,
    spaceName: 'My site',
    spaceUrl: '',
    spaceLocales: ['en'],
    spaceStarter: 'basic',
    spaceArgs: [],
    manabloxVersion: `^${cliVersion}`,
    install: true,
    git: true,
    // `--yes` must not boot anything unasked.
    start: false,
    force: false,
  };
}

/**
 * Parses command line options; absent ones stay undefined for the prompts. `--features`
 * picks the exact list of first-party plugins, `--<id>` / `--no-<id>` one of them.
 */
export function optionsFromArgs(
  options: Record<string, string>,
  flags: Record<string, boolean>,
  positionals: string[],
  cwd: string,
  pluginIds: readonly string[] = FIRST_PARTY_PLUGINS.map((plugin) => plugin.id),
): PartialOptions {
  const out: PartialOptions = {};
  const switched = pluginIds.filter((id) => booleanFlag(flags, id) !== undefined);
  if (options.features !== undefined) {
    const [first] = switched;
    if (first) {
      throw new Error(
        `--features and --${flags[first] ? '' : 'no-'}${first} both pick the features; use one`,
      );
    }
    const picked = featureList(options.features, pluginIds);
    out.plugins = Object.fromEntries(pluginIds.map((id) => [id, picked.includes(id)]));
  }
  for (const id of switched)
    out.plugins = { ...out.plugins, [id]: booleanFlag(flags, id) === true };
  const dir = options.dir ?? positionals[0];
  if (dir !== undefined) out.dir = resolve(cwd, dir);

  if (options.name !== undefined) out.name = validPackageName(options.name);
  if (options.preset !== undefined)
    out.preset = oneOf('preset', options.preset, ['local', 'docker']);
  if (options.proxy !== undefined) {
    out.proxy = oneOf('proxy', options.proxy, ['caddy', 'nginx', 'none']);
    // Only the docker preset has a proxy.
    out.preset ??= 'docker';
  }
  if (options.database !== undefined)
    out.database = oneOf('database', options.database, ['postgres', 'sqlite']);
  if (options['admin-domain'] !== undefined)
    out.adminDomain = validDomain('admin-domain', options['admin-domain']);
  if (options['public-domain'] !== undefined) {
    out.publicDomain = validDomain('public-domain', options['public-domain']);
  }
  if (options['acme-email'] !== undefined)
    out.acmeEmail = validEmail('acme-email', options['acme-email']);
  if (options['admin-port'] !== undefined)
    out.adminPort = validPort('admin-port', options['admin-port']);
  if (options['public-port'] !== undefined)
    out.publicPort = validPort('public-port', options['public-port']);
  if (options['postgres-port'] !== undefined)
    out.postgresPort = validPort('postgres-port', options['postgres-port']);
  if (options['valkey-port'] !== undefined)
    out.valkeyPort = validPort('valkey-port', options['valkey-port']);
  if (options.storage !== undefined)
    out.storage = oneOf('storage', options.storage, ['local', 's3']);
  if (options.mail !== undefined) out.mail = oneOf('mail', options.mail, MAIL_CHOICES);
  if (options['manablox-version'] !== undefined) out.manabloxVersion = options['manablox-version'];

  if (options['admin-email'] !== undefined)
    out.adminEmail = validEmail('admin-email', options['admin-email'].trim().toLowerCase());
  if (options['admin-name'] !== undefined)
    out.adminName = validUserName('admin-name', options['admin-name']);
  if (options['space-name'] !== undefined)
    out.spaceName = validSpaceName('space-name', options['space-name']);
  if (options['space-url'] !== undefined)
    out.spaceUrl = validUrl('space-url', options['space-url']);
  if (options['space-locales'] !== undefined)
    out.spaceLocales = validLocales('space-locales', options['space-locales']);

  const publicApi = booleanFlag(flags, 'public');
  if (publicApi !== undefined) out.publicApi = publicApi;
  // Naming the account asks for it.
  const describesAdmin =
    options['admin-email'] !== undefined || options['admin-name'] !== undefined;
  const admin = booleanFlag(flags, 'admin') ?? (describesAdmin ? true : undefined);
  if (admin !== undefined) out.admin = admin;
  const picked = blocksFor(
    'space-blocks',
    starterFrom('space-template', options['space-template'], booleanFlag(flags, 'space-starter')),
    options['space-blocks'],
  );
  const spaceStarter = picked.starter;
  if (spaceStarter !== undefined) out.spaceStarter = spaceStarter;
  if (picked.blocks) out.spaceBlocks = picked.blocks;
  // Describing the first space asks for it.
  const describesSpace = Object.keys(options).some((name) => name.startsWith('space-'));
  const space = booleanFlag(flags, 'space') ?? (describesSpace || spaceStarter ? true : undefined);
  if (space !== undefined) out.space = space;
  const install = booleanFlag(flags, 'install');
  if (install !== undefined) out.install = install;
  const git = booleanFlag(flags, 'git');
  if (git !== undefined) out.git = git;
  const start = booleanFlag(flags, 'start');
  if (start !== undefined) out.start = start;
  if (out.start && out.install === false) {
    throw new Error('--start needs the dependencies installed; drop --no-install');
  }
  if (flags.force) out.force = true;

  return out;
}

/** `--features ai,workflows`: known ids, each once; empty or `none` for the core alone. */
function featureList(value: string, pluginIds: readonly string[]): string[] {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 1 && entries[0] === 'none') return [];
  const picked: string[] = [];
  for (const entry of entries) {
    if (!pluginIds.includes(entry)) {
      throw new Error(
        `--features: '${entry}' is not one of ${pluginIds.join(', ')} (or none for the core alone)`,
      );
    }
    if (picked.includes(entry)) throw new Error(`--features names '${entry}' twice`);
    picked.push(entry);
  }
  return picked;
}

/** Resolves interdependent fields, e.g. a local preset has no proxy. */
export function finalizeOptions(options: CreateOptions): CreateOptions {
  const finalized = { ...options };
  if (finalized.preset === 'local') finalized.proxy = 'none';
  finalized.spaceUrl ||= defaultSpaceUrl(finalized);
  return finalized;
}

/** A plugin's address for the first space, else `manablox frontend`'s default. */
export function defaultSpaceUrl(options: Pick<CreateOptions, 'pluginSpaceUrl'>): string {
  return options.pluginSpaceUrl ?? 'http://localhost:3005';
}

/** The first space as `manablox space create` takes it. */
export function firstSpace(options: CreateOptions): SpaceOptions {
  return {
    name: options.spaceName,
    machineName: machineNameFrom(options.spaceName),
    url: options.spaceUrl || defaultSpaceUrl(options),
    locales: options.spaceLocales,
    starter: options.spaceStarter,
    blocks: options.spaceStarter === 'custom' ? (options.spaceBlocks ?? null) : null,
    owner: options.admin ? options.adminEmail : undefined,
    ...(options.spaceArgs.length ? { extraArgs: options.spaceArgs } : {}),
  };
}

export function packageNameFrom(raw: string): string {
  const name = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
  return name || 'my-cms';
}

export function validPackageName(value: string): string {
  if (!/^(@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*$/.test(value)) {
    throw new Error(
      `--name '${value}' is not a valid package name (lowercase letters, digits, '-', '_', '.')`,
    );
  }
  return value;
}

/** Prefixes `https://` unless the domain already has `http://`. */
export function originFromDomain(domain: string): string {
  return domain.startsWith('http://') ? domain : `https://${domain}`;
}

/** Host of a domain, for the default sender address. */
export function hostFromDomain(domain: string): string {
  return domain.replace(/^http:\/\//, '').replace(/:\d+$/, '');
}
