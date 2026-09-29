import type { CliContribution } from '@manablox/core';
import {
  answerOptions,
  createPlugins,
  defaultOptions,
  finalizeOptions,
  renderFiles,
} from '../../src/create/index.js';
import type { PartialOptions } from '../../src/create/options.js';
import { cliInstance, type InstancePlugin } from '../../src/create/templates.js';
import { type CliPlugin, firstPartyPlugins } from '../../src/plugins.js';
import type { Prompter } from '../../src/ui.js';

export { file } from './files.js';

const secrets = {
  authSecret: 'AUTH',
  postgresPassword: 'PGPW',
  databaseOwnerPassword: 'OWNERPW',
  databaseAppPassword: 'APPPW',
  postgresPublicPassword: 'PGPUBPW',
  // `__SITE_FORMS_SECRET__` becomes `SITEFORMSSECRET`.
  plugin: (token: string) => token.replace(/_/g, ''),
};

export function options(overrides: Partial<ReturnType<typeof defaultOptions>> = {}) {
  return finalizeOptions({
    ...defaultOptions('/tmp/my-cms', '0.4.0', ['website']),
    ...overrides,
  });
}

/** The docker preset with its own mail default, as `create` resolves it. */
export function docker(overrides: Partial<ReturnType<typeof defaultOptions>> = {}) {
  return options({ preset: 'docker', mail: 'none', ...overrides });
}

let loaded: Promise<CliPlugin[]> | undefined;

/** The first-party plugins, loaded as `manablox create` loads them. */
export function plugins(): Promise<CliPlugin[]> {
  loaded ??= firstPartyPlugins(process.cwd());
  return loaded;
}

/** The website plugin's contribution. */
async function website(): Promise<CliContribution> {
  const found = (await plugins()).find((plugin) => plugin.id === 'website');
  if (!found) throw new Error('the website plugin is not a first-party plugin');
  return found.contribution;
}

/** The website plugin's part of an instance with these options. */
async function websiteParts(
  resolved: ReturnType<typeof options>,
  sitePort = 3200,
): Promise<InstancePlugin[]> {
  const contribution = await website();
  const templates = await contribution.templates?.({
    instance: cliInstance(resolved),
    values: { sitePort },
  });
  return [{ id: 'website', templates: templates ?? {} }];
}

/** The AI plugin's part of an instance with these options. */
async function aiParts(resolved: ReturnType<typeof options>): Promise<InstancePlugin[]> {
  const found = (await plugins()).find((plugin) => plugin.id === 'ai');
  if (!found) throw new Error('the AI plugin is not a first-party plugin');
  const templates = await found.contribution.templates?.({
    instance: cliInstance(resolved),
    values: undefined,
  });
  return [{ id: 'ai', templates: templates ?? {} }];
}

/**
 * Renders an instance with the website plugin, as `create` does by default; `false` leaves
 * it out. `ai` adds the AI plugin's part too.
 */
export async function render(
  resolved: ReturnType<typeof options>,
  site: { sitePort?: number } | false = {},
  more: { ai?: boolean } = {},
) {
  return renderFiles(resolved, secrets, [
    ...(site === false ? [] : await websiteParts(resolved, site.sitePort)),
    ...(more.ai ? await aiParts(resolved) : []),
  ]);
}

/** One service's block of a rendered compose.yml. */
export function service(compose: string, name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`);
  const end = compose.slice(start + 1).search(/\n( {2}[a-z-]+:\n|volumes:\n)/);
  return compose.slice(start, start + 1 + end);
}

/** `create`'s answering with the first-party plugins; `values` are plugin options as given. */
export async function answer(
  given: PartialOptions,
  prompter: Prompter | null,
  values: Record<string, string> = {},
) {
  const loaded = await plugins();
  const defaults = defaultOptions('/tmp/blog', '0.4.0');
  const create = createPlugins(loaded, { options: values, flags: {}, lists: {} }, given.plugins);
  return answerOptions(given, defaults, prompter, create);
}
