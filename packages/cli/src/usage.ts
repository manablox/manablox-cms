import type { CliOption } from '@manablox/core';
import type { CliPlugin, FirstPartyPlugin } from './plugins.js';

/** The plugins the help lists: first-party ones for `create`, the instance's for the rest. */
export interface UsagePlugins {
  create?: readonly CliPlugin[];
  /** First-party plugins that are not installed here. */
  missing?: readonly FirstPartyPlugin[];
  instance?: readonly CliPlugin[];
}

/** Help column of an option. */
const COLUMN = 28;

/** Words to lines of at most `width` characters. */
function wrap(text: string, width = 58): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** An option's help lines, as the core's are laid out. */
function optionHelp(left: string, help: string | readonly string[]): string[] {
  const lines = typeof help === 'string' ? wrap(help) : [...help];
  const pad = ' '.repeat(COLUMN + 2);
  if (left.length >= COLUMN) return [`  ${left}`, ...lines.map((line) => `${pad}${line}`)];
  const [first = '', ...rest] = lines;
  return [`  ${left.padEnd(COLUMN)}${first}`, ...rest.map((line) => `${pad}${line}`)];
}

function optionLines(options: readonly CliOption[]): string[] {
  return options.flatMap((option) => {
    const type = option.type ?? 'value';
    const left =
      type === 'switch'
        ? `--${option.name} / --no-${option.name}`
        : `--${option.name}${option.arg ? ` ${option.arg}` : ''}`;
    return optionHelp(left, option.help);
  });
}

/** Each plugin's options of `space create`, under a heading. */
function spaceCreateLines(plugins: readonly CliPlugin[]): string[] {
  return plugins.flatMap(({ id, contribution }) => {
    const group = contribution.options?.['space create'];
    if (!group) return [];
    return ['', `  The ${id} plugin: ${contribution.summary}`, ...optionLines(group.options)];
  });
}

/** Each first-party plugin's switch and options of `create`, under a heading. */
function createLines(plugins: readonly CliPlugin[]): string[] {
  return plugins.flatMap(({ id, contribution }) => [
    '',
    `  The ${id} plugin: ${contribution.summary}`,
    ...optionHelp(`--${id} / --no-${id}`, 'include the plugin (default: no)'),
    ...optionLines(contribution.options?.create?.options ?? []),
  ]);
}

/** `manablox <id> <command>` sections. */
function commandLines(plugins: readonly CliPlugin[]): string[] {
  return plugins.flatMap(({ id, contribution }) => {
    const commands = Object.entries(contribution.commands ?? {});
    if (!commands.length) return [];
    return [
      `manablox ${id} <command> [options]`,
      `  The ${id} plugin: ${contribution.summary}`,
      ...commands.flatMap(([words, command]) => [
        '',
        ...optionHelp(`${words}${command.args ? ` ${command.args}` : ''}`, command.description),
        ...optionLines(command.options ?? []),
      ]),
      '',
    ];
  });
}

/** One plugin's commands, for `manablox <id> --help`. */
export function pluginUsage(plugin: CliPlugin): string {
  return [
    ...commandLines([plugin]),
    ...optionHelp('--config <file>', 'the instance config (default: manablox.config.ts)'),
    ...optionHelp('--yes', 'ask nothing (also without a terminal)'),
    '',
  ].join('\n');
}

/** `manablox --help`. */
export function usage(plugins: UsagePlugins = {}): string {
  const create = plugins.create ?? [];
  const instance = plugins.instance ?? [];
  const commands = instance.filter(
    (plugin) => Object.keys(plugin.contribution.commands ?? {}).length,
  );
  return [
    'Usage: manablox <command> [options]',
    '',
    'Commands:',
    '  start        boot the instance described by manablox.config.ts and listen',
    '  migrate      bring the database up to date',
    '  backup       copy a SQLite database to a file while it runs: manablox backup <file>',
    '  migrate-db   copy a SQLite database into Postgres (see below)',
    '  sync         write the resources the config declares into the database',
    '  push-keys    print a VAPID key pair for Web Push',
    '  docs         write the reference pages: manablox docs generate --out <dir> (see below)',
    '  user         create an account: manablox user create --email <email> (see below)',
    '  space        create a space: manablox space create --name <name> (see below)',
    '  create       scaffold a new instance into a folder (see below)',
    '  plugin       list, install, uninstall, enable or disable plugins (see below)',
    '  frontend     scaffold a frontend for a space into a folder (see below)',
    ...commands.map((plugin) => `  ${plugin.id.padEnd(12)} the ${plugin.id} plugin (see below)`),
    '',
    'Options:',
    '  --config <file>   config file (default: manablox.config.ts in the working directory)',
    "  --mode <mode>     management (default), public or a plugin's mode such as website;",
    '                    overrides server.mode',
    '  --port <port>     overrides server.port',
    '  --host <host>     overrides server.host',
    '  --watch           start: restart when the config or anything it imports changes',
    '  --space <name>    sync: only this space, by machine name',
    '  --dry-run         sync: report what would change and write nothing (exit 2 if any)',
    '  --prune           sync: delete what no declaration covers instead of switching it off',
    '  -h, --help        this message',
    '',
    'manablox migrate-db --to <postgres-url> [options]',
    '  Copies the SQLite database of manablox.config.ts into an empty Postgres database:',
    '  creates the schema, copies every table, then compares row counts, the audit chain',
    '  and a sample of rows. Refuses while the instance state is active; set it to',
    '  readOnly through the control API first. Exits 2 when the verification fails.',
    '',
    '  --to <url>                  the Postgres database to fill (required)',
    '  --replace                   drop the schema of a target that holds rows first',
    '  --force-offline             skip the state check; the instance is stopped',
    '  --app-role <role>           grant this app role after migrating, as with',
    '                              MIGRATION_DATABASE_URL (default: the roles granted before)',
    '',
    'manablox docs generate --out <dir> [--config <file>]',
    '  Writes the reference pages derived from the code into <dir>: reference/errors.md,',
    '  reference/http-api.md and extending/hooks.md, with the error keys and procedures of',
    "  the config's plugins. Loads the config without booting it; no database is needed.",
    '',
    '  --out <dir>                 the folder to write into (required)',
    '',
    'manablox create [dir] [options]',
    '  Writes a runnable instance: config files, .env with generated secrets, compose stack.',
    '  Every option that is not given is asked for; with --yes or without a terminal the',
    '  defaults apply.',
    '',
    '  --name <name>               package and compose project name (default: the folder name)',
    '  --preset local|docker       local: Docker runs Postgres and Valkey, the CMS runs here',
    '                              (default); docker: every process in containers',
    '  --proxy caddy|nginx|none    docker preset, implied by this option: Caddy with automatic',
    '                              TLS (default), nginx with your certificates, or published',
    '                              ports for a proxy elsewhere',
    '  --database postgres|sqlite  postgres (default), or sqlite: one file, no database',
    '                              server, a single management instance',
    '  --public / --no-public      add the hardened public delivery instance (default: yes)',
    '  --admin-domain <host>       Caddy, nginx: domain of the admin and management API',
    '  --public-domain <host>      Caddy, nginx: domain of the public delivery API',
    '  --acme-email <email>        Caddy: where certificate notices go',
    '  --admin-port <port>         without a proxy: the management port (default: 3000)',
    '  --public-port <port>        without a proxy: the delivery port (default: 3100)',
    '  --postgres-port <port>      local preset with postgres: published Postgres port',
    '                              (default: 5432)',
    '  --valkey-port <port>        local preset: published Valkey port (default: 6379)',
    '  --storage local|s3          where uploads live (default: local)',
    '  --mail <driver>             how mail leaves: smtp, mailpit, gmail, microsoft, resend,',
    '                              sendgrid, postmark, mailgun or none (default: mailpit for',
    '                              the local preset, none for docker)',
    '  --admin / --no-admin        create the first account, a superadmin, once the instance',
    '                              runs, or list the command in the next steps (default: yes)',
    '  --admin-email <email>       its email (default: admin@example.com)',
    '  --admin-name <name>         its name (default: Administrator)',
    '                              The password is asked when starting, read from',
    '                              MANABLOX_USER_PASSWORD, or generated and shown once',
    '  --space / --no-space        create a first space once the instance runs, or list the',
    '                              command in the next steps (default: yes)',
    "  --space-name <name>         the first space's name (default: My site)",
    '  --space-url <url>           the website address (default: what a plugin such as the',
    '                              website plugin picks, else http://localhost:3005)',
    '  --space-locales <list>      comma separated, the first is the default (default: en)',
    "  --space-template <id>       the first space's website type: business, landing,",
    '                              portfolio, blog, basic (default) or custom; see',
    '                              --template under manablox space create',
    '  --space-blocks <list>       the sections of the custom type, comma separated; see',
    '                              --blocks under manablox space create',
    '  --space-starter / --no-space-starter',
    '                              the basic template, or an empty space',
    "  --manablox-version <range>  the @manablox/* range to depend on (default: this CLI's)",
    '  --install / --no-install    run pnpm install afterwards (default: yes)',
    '  --git / --no-git            run git init afterwards (default: yes)',
    '  --start / --no-start        start the instance once installed: docker builds and starts',
    '                              the stack, local starts the services, migrates and runs',
    '                              pnpm dev (default: no)',
    '  --force                     write into a folder that is not empty',
    '  --yes                       ask nothing, take the defaults',
    '  --features <list>           the features, comma separated, exactly these: website, ai,',
    '                              workflows, webhooks, or none (default: asked; with --yes',
    '                              or without a terminal none, the core alone); or pick one',
    '                              at a time with the switches below',
    ...createLines(create),
    ...(plugins.missing ?? []).flatMap((plugin) => [
      '',
      `  The ${plugin.id} plugin (${plugin.package}, installed when needed)`,
      ...optionHelp(
        `--${plugin.id} / --no-${plugin.id}`,
        `include the plugin (default: no); its options show once ${plugin.package} is installed`,
      ),
    ]),
    '',
    'manablox plugin <command> [options]',
    '  Adds and removes features on an existing instance, in its folder. A first-party plugin',
    '  is named by its id (website, ai, workflows, webhooks), any other by its npm package.',
    '',
    '  list                        the first-party plugins, the installed and configured ones,',
    '                              their migrations and instance flags (with a database)',
    '  install <id|package>...     add the dependency, the marked parts of the instance files',
    '                              and the plugins file entry, install, migrate',
    '  uninstall <id>...           remove them again; the data stays (tables, ext.<id>), and',
    '                              installing again brings it back',
    '  enable <id> / disable <id>  switch features.plugins.<id> on or off',
    '',
    '  --yes                       install: ask nothing; uninstall: do not ask to confirm',
    '  --install / --no-install    install, uninstall: run the package manager (default: yes)',
    '  --migrate / --no-migrate    install: migrate the database when reachable (default: yes)',
    '  --strict                    install, uninstall: exit 1 when a file lacks its anchor',
    '                              (its part is printed instead of written either way)',
    '  --space <name>              enable, disable: in this space, by machine name, instead',
    '                              of for the whole instance',
    "  --<option>                  install: a first-party plugin's create option instead of",
    '                              its question, e.g. install website --site-port 3300',
    '',
    'manablox user create --email <email> [options]',
    '  Creates an account that signs in with email and password. The first account is a',
    '  superadmin and owns every space. The password comes from MANABLOX_USER_PASSWORD or',
    '  is asked twice in the terminal. Does nothing when the email exists already.',
    '',
    '  --email <email>             the email to sign in with (required)',
    '  --name <name>               the display name (default: Administrator)',
    '  --role superadmin|editor    the instance role (default: superadmin)',
    '',
    'manablox space create --name <name> [options]',
    '  Creates a space as the admin does, in the database of manablox.config.ts. Without',
    '  --owner the first account to sign up owns it. Does nothing when the technical name',
    '  exists already.',
    '',
    '  --name <name>               the display name (required)',
    '  --machine-name <name>       the technical name (default: derived from the name)',
    '  --url <url>                 the website address (default: http://localhost:3200)',
    '  --locales <list>            comma separated, the first is the default (default: en)',
    '  --template <id>             a website type with its content model, example pages and',
    '                              main menu (default: none, an empty space): business',
    '                              (company website), landing (product or landing page),',
    '                              portfolio, blog, basic, or custom with --blocks',
    '  --blocks <list>             the sections of the custom type, comma separated; implies',
    '                              --template custom: hero, text, media-text, image, gallery,',
    '                              quote, features, stats, faq, pricing, testimonials, team,',
    '                              contact, call-to-action (default: hero, text, media-text,',
    '                              gallery, quote, call-to-action)',
    '  --starter / --no-starter    the same as --template basic, or none',
    '  --plan <file>               a JSON content type plan (types that reference each other',
    '                              by name, as contentTypes.applyPlan takes them), added after',
    '                              the template',
    '  --owner <email>             the account that owns it (default: none, the first',
    '                              account to sign up in the admin)',
    '  --plugin-data <id>=<json>   data for a plugin that takes part in creating spaces,',
    '                              e.g. hello=\'{"greeting":"Hi"}\'; repeat it per plugin',
    ...spaceCreateLines(instance),
    '',
    'manablox frontend [dir] [options]',
    '  Writes a frontend that reads from the delivery API: routing by permalink, blocks',
    '  through a renderer registry, a /preview route for the visual editor, and typed',
    '  content through `pnpm types`. No API key is involved.',
    '',
    '  --framework <name>          plain: Vite and TypeScript, rendered in the browser',
    '                              astro: Astro, server-rendered on Node (default)',
    '                              react-ssr: Vite and React, rendered and hydrated',
    '                              vue-ssr: Vite and Vue, rendered and hydrated',
    '  --name <name>               package name (default: the folder name)',
    '  --url <url>                 the delivery API to read from (default: http://localhost:3100)',
    "  --editor-origin <url>       the admin's origin, which the preview channel checks",
    '                              (default: http://localhost:3000)',
    '  --space-id <id>             only needed against a management instance',
    '  --port <port>               the dev server port (default: one per framework)',
    "  --manablox-version <range>  the @manablox/* range to depend on (default: this CLI's)",
    '  --install / --no-install    run pnpm install afterwards (default: yes)',
    '  --git / --no-git            run git init afterwards (default: yes)',
    '  --force                     write into a folder that is not empty',
    '  --yes                       ask nothing, take the defaults',
    '',
    "  Components for a space's content and block types, read from a running instance:",
    '  --model <source>            management: the management API, with an API key',
    '                              delivery: the delivery API --url points at, no key',
    '                              none: the example teaser block (default without a terminal)',
    '  --api-url <url>             the management API (default: http://localhost:3000)',
    '  --api-key <key>             an API key that may read the space (implies management)',
    '  --space <name>              the space, by machine name or id (needed with several)',
    '  --types <a,b|all>           the types to write components for (default: all)',
    '',
    ...commandLines(instance),
  ].join('\n');
}
