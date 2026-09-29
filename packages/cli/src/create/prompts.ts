import {
  DEFAULT_SPACE_BLOCKS,
  SPACE_BLOCKS,
  SPACE_TEMPLATES,
  type SpaceBlockId,
  type SpaceTemplateId,
} from '@manablox/core';
import { validDomain, validEmail, validPort, validUrl } from '../args.js';
import { validSpaceName } from '../space/options.js';
import { askInstallAndGit, askParsed, type Prompter, validateWith } from '../ui.js';
import { validPassword, validUserName } from '../user/options.js';
import type { CreateOptions, PartialOptions } from './options.js';
import { defaultMail, defaultSpaceUrl, validPackageName } from './options.js';

/** A feature in the choice. */
interface FeatureChoice {
  id: string;
  label: string;
  hint: string;
  /** Plugins it works together with, by id. */
  enhances: readonly string[];
}

/** The first-party plugins' part in the questions. */
export interface PluginQuestions {
  /** `--features`, `--<id>` / `--no-<id>` as given. */
  given: Record<string, boolean>;
  /** The features to choose from. */
  features: readonly FeatureChoice[];
  /** Runs the included plugins' options, after the first space's name. */
  apply(options: CreateOptions): Promise<void>;
}

/** A feature's hint with the features it pairs with, both ways. */
function featureHint(feature: FeatureChoice, all: readonly FeatureChoice[]): string {
  const pairs = all.filter(
    (other) =>
      other.id !== feature.id &&
      (feature.enhances.includes(other.id) || other.enhances.includes(feature.id)),
  );
  if (!pairs.length) return feature.hint;
  const labels = pairs.map((other) => other.label);
  const listed =
    labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : labels[0];
  return `${feature.hint}; pairs with ${listed}`;
}

/** Asks for options the command line left open, skipping ones earlier answers made irrelevant. */
export async function askMissing(
  given: PartialOptions,
  defaults: CreateOptions,
  prompter: Prompter,
  plugins?: PluginQuestions,
): Promise<CreateOptions> {
  const options: CreateOptions = {
    ...defaults,
    ...given,
    plugins: { ...defaults.plugins, ...given.plugins },
  };

  const ask = <T>(message: string, fallback: string, parse: (raw: string) => T) =>
    askParsed(prompter, message, fallback, parse);

  if (given.name === undefined) {
    options.name = await ask('Project name', defaults.name, validPackageName);
  }

  if (given.database === undefined) {
    options.database = await prompter.select({
      message: 'Which database?',
      options: [
        { value: 'postgres', label: 'Postgres', hint: 'a database server, run in Docker' },
        {
          value: 'sqlite',
          label: 'SQLite',
          hint: 'one file, no database server; a single management instance',
        },
      ] as const,
      initialValue: defaults.database,
    });
  }
  const sqlite = options.database === 'sqlite';

  if (given.preset === undefined || (given.preset === 'docker' && given.proxy === undefined)) {
    const run = await prompter.select({
      message: 'How will this instance run?',
      options: [
        {
          value: 'local',
          label: 'Local development',
          hint: sqlite
            ? 'Docker runs Valkey, the CMS runs here; the quickest trial'
            : 'Docker runs Postgres and Valkey, the CMS runs here; the quickest trial',
        },
        {
          value: 'docker-caddy',
          label: 'Docker behind Caddy',
          hint: 'the whole stack, automatic TLS; production',
        },
        {
          value: 'docker-nginx',
          label: 'Docker behind nginx',
          hint: 'the whole stack, your certificates',
        },
        {
          value: 'docker-none',
          label: 'Docker, ports published',
          hint: 'behind a proxy of your own',
        },
      ] as const,
      initialValue:
        (given.preset ?? defaults.preset) === 'local' ? 'local' : `docker-${defaults.proxy}`,
    });
    options.preset = run === 'local' ? 'local' : 'docker';
    options.proxy = run === 'docker-caddy' ? 'caddy' : run === 'docker-nginx' ? 'nginx' : 'none';
  }

  if (given.publicApi === undefined) {
    options.publicApi = await prompter.confirm({
      message:
        'Add a public delivery instance? (read-only API for your frontends, pinned to one space)',
      initialValue: defaults.publicApi,
    });
  }

  // One choice for every feature the command line left open; the rest may depend on it.
  const open = (plugins?.features ?? []).filter(
    (feature) => plugins?.given[feature.id] === undefined,
  );
  if (open.length) {
    const picked = await prompter.multiselect({
      message:
        'Which features does this instance get? (none: the core alone; manablox plugin install adds one later)',
      groups: {
        Features: open.map((feature) => ({
          value: feature.id,
          label: feature.label,
          hint: featureHint(feature, plugins?.features ?? []),
        })),
      },
      initialValues: open.filter((feature) => defaults.plugins[feature.id]).map(({ id }) => id),
      required: false,
    });
    for (const { id } of open) options.plugins[id] = picked.includes(id);
  }

  const byDomain = options.preset === 'docker' && options.proxy !== 'none';
  if (byDomain) {
    if (given.adminDomain === undefined) {
      options.adminDomain = await ask(
        'Domain of the admin and management API',
        defaults.adminDomain,
        (raw) => validDomain('admin-domain', raw),
      );
    }
    if (options.publicApi && given.publicDomain === undefined) {
      options.publicDomain = await ask(
        'Domain of the public delivery API',
        defaults.publicDomain,
        (raw) => validDomain('public-domain', raw),
      );
    }
    if (options.proxy === 'caddy' && given.acmeEmail === undefined) {
      options.acmeEmail = await ask(
        'Email for TLS certificate notices',
        defaults.acmeEmail,
        (raw) => validEmail('acme-email', raw),
      );
    }
  } else {
    if (given.adminPort === undefined) {
      options.adminPort = await ask(
        'Port of the admin and management API',
        String(defaults.adminPort),
        (raw) => validPort('admin-port', raw),
      );
    }
    if (options.publicApi && given.publicPort === undefined) {
      options.publicPort = await ask(
        'Port of the public delivery API',
        String(defaults.publicPort),
        (raw) => validPort('public-port', raw),
      );
    }
  }

  if (options.preset === 'local') {
    if (!sqlite && given.postgresPort === undefined) {
      options.postgresPort = await ask(
        'Port to publish Postgres on',
        String(defaults.postgresPort),
        (raw) => validPort('postgres-port', raw),
      );
    }
    if (given.valkeyPort === undefined) {
      options.valkeyPort = await ask(
        'Port to publish Valkey on',
        String(defaults.valkeyPort),
        (raw) => validPort('valkey-port', raw),
      );
    }
  }

  if (given.storage === undefined) {
    options.storage = await prompter.select({
      message: 'Where do uploads live?',
      options: [
        { value: 'local', label: 'On disk', hint: 'a Docker volume, or ./data/uploads' },
        { value: 's3', label: 'An S3 compatible bucket', hint: 'credentials go into .env' },
      ] as const,
      initialValue: defaults.storage,
    });
  }

  if (given.mail === undefined) {
    options.mail = await prompter.select({
      message: 'How does this instance send mail?',
      options: [
        {
          value: 'mailpit',
          label: 'Mailpit',
          hint: 'catches every mail in a local inbox; development',
        },
        { value: 'smtp', label: 'An SMTP server', hint: 'host and login go into .env' },
        { value: 'gmail', label: 'Gmail', hint: 'a Google mailbox over the Gmail API' },
        {
          value: 'microsoft',
          label: 'Microsoft 365',
          hint: 'a mailbox over Microsoft Graph sendMail',
        },
        { value: 'resend', label: 'Resend', hint: 'API key goes into .env' },
        { value: 'sendgrid', label: 'SendGrid', hint: 'API key goes into .env' },
        { value: 'postmark', label: 'Postmark', hint: 'server token goes into .env' },
        { value: 'mailgun', label: 'Mailgun', hint: 'API key and domain go into .env' },
        { value: 'none', label: 'No mail', hint: 'workflow mails fail, notifications stay in-app' },
      ] as const,
      initialValue: defaultMail(options.preset),
    });
  }

  if (given.admin === undefined) {
    options.admin = await prompter.confirm({
      message:
        'Create the administrator account now? (the superadmin you sign in to the admin with)',
      initialValue: defaults.admin,
    });
  }
  if (options.admin) {
    if (given.adminEmail === undefined) {
      options.adminEmail = await ask('Email of the administrator', defaults.adminEmail, (raw) =>
        validEmail('admin-email', raw.trim().toLowerCase()),
      );
    }
    if (given.adminName === undefined) {
      options.adminName = await ask('Name of the administrator', defaults.adminName, (raw) =>
        validUserName('admin-name', raw),
      );
    }
  }

  if (given.space === undefined) {
    options.space = await prompter.confirm({
      message: 'Create a first space? (the content and website of one site)',
      initialValue: defaults.space,
    });
  }
  if (options.space) {
    if (given.spaceName === undefined) {
      options.spaceName = await ask('Name of the first space', defaults.spaceName, (raw) =>
        validSpaceName('space-name', raw),
      );
    }
  }
  // Plugins ask their own questions here, and may pick the first space's address.
  await plugins?.apply(options);
  if (options.space) {
    if (given.spaceUrl === undefined) {
      options.spaceUrl = await ask('Address of the website', defaultSpaceUrl(options), (raw) =>
        validUrl('space-url', raw),
      );
    }
    if (given.spaceStarter === undefined) {
      const start = await prompter.select<'preset' | 'empty'>({
        message: 'What does the space start with?',
        options: [
          {
            value: 'preset',
            label: 'Preconfigured',
            hint: 'a type of website with its sections, example pages and a menu',
          },
          { value: 'empty', label: 'Empty space', hint: 'no content types, documents or menus' },
        ],
        initialValue: defaults.spaceStarter ? 'preset' : 'empty',
      });
      options.spaceStarter =
        start === 'empty'
          ? null
          : await prompter.select<SpaceTemplateId>({
              message: 'What kind of website is it?',
              options: SPACE_TEMPLATES.map((entry) => ({
                value: entry.id,
                label: entry.name,
                hint: entry.description,
              })),
              initialValue: defaults.spaceStarter ?? 'business',
            });
    }
    if (options.spaceStarter === 'custom' && given.spaceBlocks === undefined) {
      options.spaceBlocks = await prompter.multiselect<SpaceBlockId>({
        message: 'Which sections are the pages built from?',
        groups: {
          Sections: SPACE_BLOCKS.map((entry) => ({
            value: entry.id,
            label: entry.name,
            hint: entry.description,
          })),
        },
        initialValues: [...DEFAULT_SPACE_BLOCKS],
      });
    }
  }

  Object.assign(options, await askInstallAndGit(prompter, given, defaults));
  // Starting needs the install (and, for Docker, its lockfile).
  if (given.start === undefined && options.install) {
    options.start = await prompter.confirm({
      message:
        options.preset === 'docker'
          ? 'Build and start the Docker stack once everything is installed?'
          : `Start ${sqlite ? 'Valkey' : 'Postgres and Valkey'}, migrate and run pnpm dev once everything is installed?`,
      initialValue: defaults.start,
    });
  }
  // Only the start steps create the account; otherwise its command asks later.
  if (options.admin && options.start && given.adminPassword === undefined) {
    const password = await prompter.password({
      message: 'Password of the administrator',
      validate: validateWith(validPassword),
    });
    await prompter.password({
      message: 'Repeat the password',
      validate: (value) => (value === password ? undefined : 'the passwords differ'),
    });
    options.adminPassword = password;
  }

  return options;
}
