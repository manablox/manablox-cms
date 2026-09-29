import {
  type CliInstance,
  type CliProcess,
  type CliTemplates,
  MAIL_DRIVER_ENV,
  MAIL_DRIVERS,
  type MailDriver,
} from '@manablox/core';
import type { ScaffoldFile } from '../scaffold.js';
import {
  type Flags,
  fill,
  renderTemplate,
  type SlotPart,
  type Slots,
  type Tokens,
} from '../template-files.js';
import { VERSIONS } from '../versions.js';
import type { CreateOptions } from './options.js';
import { hostFromDomain, originFromDomain } from './options.js';

export interface Secrets {
  authSecret: string;
  postgresPassword: string;
  /** The Postgres role that owns the schema and runs the migrations. */
  databaseOwnerPassword: string;
  /** The Postgres role the CMS logs in as. */
  databaseAppPassword: string;
  postgresPublicPassword: string;
  /** A plugin's secret by its token. */
  plugin: (token: string) => string;
}

/** A plugin's part of a new instance. */
export interface InstancePlugin {
  id: string;
  templates: CliTemplates;
}

/**
 * The core's processes besides `api`. A plugin's processes reach the core files only through
 * slots (see `processSlots`), so installing or removing the plugin touches its regions alone.
 */
function instanceProcesses(options: CreateOptions): CliProcess[] {
  return options.publicApi
    ? [{ name: 'public', port: 3100, readOnly: true, label: 'the public instance' }]
    : [];
}

/** A plugin's processes as fragments of the Dockerfile and the restore script. */
function processSlots(processes: readonly CliProcess[]): Record<string, string> {
  if (!processes.length) return {};
  return {
    'dockerfile.expose': `EXPOSE ${processes.map((process) => process.port).join(' ')}`,
    'restore.processes': `processes+=(${processes.map((process) => process.name).join(' ')})`,
  };
}

/**
 * A plugin's slot fragments. Both configs import their plugins from one file, so the imports
 * of `config.imports` and `public.imports` go to its one import anchor, each line once.
 */
function slotFragments(templates: CliTemplates): Record<string, string> {
  const { 'public.imports': publicImports, ...slots } = templates.slots ?? {};
  const fragments: Record<string, string> = {
    ...slots,
    ...processSlots(templates.processes ?? []),
  };
  const imports = [slots['config.imports'], publicImports]
    .flatMap((fragment) => (fragment ?? '').split('\n'))
    .filter((line, index, all) => line.trim() && all.indexOf(line) === index);
  if (imports.length) fragments['config.imports'] = imports.join('\n');
  return fragments;
}

/** The plugins' tokens, flags, secrets and slots, merged; a clash with the core or another plugin throws. */
function pluginParts(
  plugins: InstancePlugin[],
  core: { tokens: Tokens; flags: Flags },
  secrets: Secrets,
): { tokens: Tokens; blanks: Tokens; flags: Flags; slots: Slots } {
  const tokens: Tokens = {};
  const blanks: Tokens = {};
  const flags: Flags = {};
  const slots: Record<string, SlotPart[]> = {};
  const claim = (kind: string, name: string, taken: object, id: string) => {
    if (Object.hasOwn(taken, name)) throw new Error(`the ${id} plugin's ${kind} ${name} is taken`);
  };
  for (const { id, templates } of plugins) {
    for (const [name, value] of Object.entries(templates.tokens ?? {})) {
      claim('token', name, { ...core.tokens, ...tokens }, id);
      tokens[name] = value;
    }
    for (const name of templates.secrets ?? []) {
      claim('token', name, { ...core.tokens, ...tokens }, id);
      tokens[name] = secrets.plugin(name);
      blanks[name] = '';
    }
    for (const [name, value] of Object.entries(templates.flags ?? {})) {
      claim('flag', name, { ...core.flags, ...flags }, id);
      flags[name] = value;
    }
    for (const [name, fragment] of Object.entries(slotFragments(templates))) {
      if (fragment) slots[name] = [...(slots[name] ?? []), { id, fragment }];
    }
  }
  return { tokens, blanks, flags, slots };
}

/** Renders every file of a new instance from `templates/instance/` and the plugins' parts; pure. */
export function renderFiles(
  options: CreateOptions,
  secrets: Secrets,
  plugins: InstancePlugin[] = [],
): ScaffoldFile[] {
  const processes = instanceProcesses(options);
  const core = {
    flags: instanceFlags(options, plugins),
    tokens: instanceTokens(options, secrets, processes, plugins),
  };
  const parts = pluginParts(plugins, core, secrets);
  const flags: Flags = { ...core.flags, ...parts.flags };
  const tokens = { ...core.tokens, ...parts.tokens };
  const render = (template: string, extra: Tokens = {}, more: Flags = {}) =>
    renderTemplate(
      `instance/${template}`,
      { ...tokens, ...extra },
      { ...flags, ...more },
      parts.slots,
    );
  const preset = options.preset;
  const mailSection = render('fragments/readme-mail.md');

  const files: ScaffoldFile[] = [
    { path: 'package.json', content: render('package.json') },
    { path: 'pnpm-workspace.yaml', content: render('pnpm-workspace.yaml') },
    { path: 'tsconfig.json', content: render('tsconfig.json') },
    { path: 'content-model.ts', content: render('content-model.ts') },
    { path: 'manablox.config.ts', content: render('manablox.config.ts') },
    { path: 'manablox.plugins.ts', content: render('manablox.plugins.ts') },
    { path: '.gitignore', content: render('gitignore') },
    {
      path: '.env.example',
      content: render('env', { ...blankSecrets, ...parts.blanks }, { example: true }),
    },
    { path: '.env', content: render('env') },
    { path: 'compose.yml', content: render(`${preset}/compose.yml`) },
    {
      path: 'README.md',
      content: render(`${preset}/README.md`, { __MAIL_SECTION__: mailSection }),
    },
  ];

  if (options.publicApi) {
    files.push({
      path: 'manablox.public.config.ts',
      content: render('manablox.public.config.ts'),
    });
  }
  for (const { templates } of plugins) {
    for (const file of templates.files ?? []) {
      files.push({
        path: file.path,
        content: fill(file.template, tokens, flags, parts.slots, file.path),
        ...(file.executable ? { executable: true } : {}),
      });
    }
  }
  if (!flags.sqlite) {
    files.push({
      path: 'postgres/init/10-roles.sh',
      content: render('postgres/init/10-roles.sh'),
      executable: true,
    });
  }
  if (flags.readOnlyRole) {
    files.push({
      path: 'postgres/init/20-public-role.sh',
      content: render('postgres/init/20-public-role.sh'),
      executable: true,
    });
  }

  if (preset === 'docker') {
    files.push(
      { path: 'Dockerfile', content: render('Dockerfile') },
      { path: '.dockerignore', content: render('dockerignore') },
      { path: 'scripts/lockfile.sh', content: render('scripts/lockfile.sh'), executable: true },
      { path: 'scripts/backup.sh', content: render('scripts/backup.sh'), executable: true },
      {
        path: 'scripts/restore.sh',
        content: render('scripts/restore.sh'),
        executable: true,
      },
    );
    if (options.proxy === 'caddy') {
      files.push({ path: 'caddy/Caddyfile', content: render('caddy/Caddyfile') });
    }
    if (options.proxy === 'nginx') {
      // One `server` group per domain; only the admin one takes uploads, and TLS depends on the domain alone.
      const site = (variable: string, domain: string, upstream: string, admin: boolean) =>
        trimNewline(
          render(
            'fragments/nginx-site.conf',
            { __DOMAIN_VARIABLE__: variable, __UPSTREAM__: upstream },
            { admin, tls: !domain.startsWith('http://') },
          ),
        );
      files.push({
        path: 'nginx/templates/default.conf.template',
        content: render('nginx/templates/default.conf.template', {
          __ADMIN_SITE__: site('ADMIN_DOMAIN', options.adminDomain, 'api:3000', true),
          __PUBLIC_SITE__: site('PUBLIC_DOMAIN', options.publicDomain, 'public:3100', false),
        }),
      });
      if (nginxUsesTls(options)) {
        const hosts = tlsHosts(options);
        files.push(
          { path: 'nginx/certs/.gitignore', content: render('nginx/certs/gitignore') },
          {
            path: 'scripts/selfsigned-certs.sh',
            content: render('scripts/selfsigned-certs.sh', {
              __TLS_HOST__: hosts[0] ?? '',
              __TLS_SAN__: hosts.map((host) => `DNS:${host}`).join(','),
              __TLS_HOSTS__: hosts.join(', '),
            }),
            executable: true,
          },
        );
      }
    }
  }

  const paths = new Set<string>();
  for (const file of files) {
    if (paths.has(file.path)) throw new Error(`two templates write ${file.path}`);
    paths.add(file.path);
  }
  // Code point order is locale independent.
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** The instance as a plugin's CLI contribution sees it. */
export function cliInstance(options: CreateOptions): CliInstance {
  return {
    name: options.name,
    preset: options.preset,
    proxy: options.preset === 'local' ? 'none' : options.proxy,
    database: options.database,
    publicApi: options.publicApi,
    byDomain: routesByDomain(options),
    adminUrl: adminUrl(options),
    manabloxVersion: options.manabloxVersion,
    space: options.space ? { name: options.spaceName } : null,
  };
}

/** The `{{#if}}` flags every instance template may test. */
function instanceFlags(options: CreateOptions, plugins: InstancePlugin[]): Flags {
  const docker = options.preset === 'docker';
  const sqlite = options.database === 'sqlite';
  const caddy = docker && options.proxy === 'caddy';
  const nginx = docker && options.proxy === 'nginx';
  return {
    docker,
    local: !docker,
    sqlite,
    publicApi: options.publicApi,
    // The read-only Postgres role, for the public instance and the plugins' processes that
    // only read.
    readOnlyRole:
      !sqlite &&
      (options.publicApi ||
        plugins.some(({ templates }) => templates.processes?.some((process) => process.readOnly))),
    caddy,
    nginx,
    byDomain: caddy || nginx,
    // Docker without a proxy publishes the API ports.
    ports: docker && !caddy && !nginx,
    tls: nginx && nginxUsesTls(options),
    mailpit: options.mail === 'mailpit',
    mailNone: options.mail === 'none',
    mailProvider: options.mail !== 'none' && options.mail !== 'mailpit',
    mailConfigured: options.mail !== 'none',
    mailbox: mailboxDriver(options.mail),
    // `.env.example` has the secrets blank.
    example: false,
  };
}

/** The `package.json` dependencies, sorted. */
function dependencies(options: CreateOptions, plugins: InstancePlugin[]): string {
  const version = options.manabloxVersion;
  const all: Record<string, string> = {
    '@manablox/admin': version,
    '@manablox/cli': version,
    '@manablox/core': version,
    '@manablox/fields': version,
    '@manablox/server': version,
  };
  for (const plugin of plugins) Object.assign(all, plugin.templates.dependencies);
  return Object.keys(all)
    .sort()
    .map((name) => `    ${JSON.stringify(name)}: ${JSON.stringify(all[name])}`)
    .join(',\n');
}

/** The `__TOKEN__` values every instance template may use; secrets last. */
function instanceTokens(
  options: CreateOptions,
  secrets: Secrets,
  processes: CliProcess[],
  plugins: InstancePlugin[],
): Tokens {
  const byDomain = routesByDomain(options);
  const mailHost = byDomain ? hostFromDomain(options.adminDomain) : 'localhost';
  const names = processes.map((process) => process.name);
  return {
    __NAME__: options.name,
    __COMPOSE_NAME__: composeName(options),
    __ADMIN_URL__: adminUrl(options),
    __PUBLIC_API_URL__: publicApiUrl(options),
    __ADMIN_PORT__: String(options.adminPort),
    __PUBLIC_PORT__: String(options.publicPort),
    __PROCESSES__: ['api', ...names].join(' '),
    __LOG_SERVICES__: ['api', ...names].join(' '),
    __EXPOSE_PORTS__: [3000, ...processes.map((process) => process.port)].join(' '),
    __DEPENDENCIES__: dependencies(options, plugins),
    __POSTGRES_PORT__: String(options.postgresPort),
    __VALKEY_PORT__: String(options.valkeyPort),
    __ADMIN_DOMAIN__: options.adminDomain,
    __PUBLIC_DOMAIN__: options.publicDomain,
    __ADMIN_HOST__: hostFromDomain(options.adminDomain),
    __PUBLIC_HOST__: hostFromDomain(options.publicDomain),
    __ACME_EMAIL__: options.acmeEmail,
    __MAIL_HOST__: mailHost,
    __STORAGE__: options.storage,
    __MAIL_DRIVER__: options.mail,
    __MAIL_DRIVER_ENV__: mailDriverEnv(options),
    __MAIL_TABLE__: mailTable(),
    // `@manablox/cli` is a runtime dependency: the image installs `--prod` and runs its bin.
    __MANABLOX_VERSION__: jsonString(options.manabloxVersion),
    __TYPES_NODE_VERSION__: VERSIONS['@types/node'],
    __TYPESCRIPT_VERSION__: VERSIONS.typescript,
    __AUTH_SECRET__: secrets.authSecret,
    __POSTGRES_PASSWORD__: secrets.postgresPassword,
    __DATABASE_OWNER_PASSWORD__: secrets.databaseOwnerPassword,
    __DATABASE_APP_PASSWORD__: secrets.databaseAppPassword,
    __POSTGRES_PUBLIC_PASSWORD__: secrets.postgresPublicPassword,
  };
}

const blankSecrets: Tokens = {
  __AUTH_SECRET__: '',
  __POSTGRES_PASSWORD__: '',
  __DATABASE_OWNER_PASSWORD__: '',
  __DATABASE_APP_PASSWORD__: '',
  __POSTGRES_PUBLIC_PASSWORD__: '',
};

/** A fragment inserted at a token on its own line; the template supplies that line's newline. */
function trimNewline(content: string): string {
  return content.replace(/\n$/, '');
}

/** A value to place inside a JSON string. */
function jsonString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/** The compose project and image name: no scope marker or slash. */
function composeName(options: CreateOptions): string {
  return options.name.replace(/^@/, '').replace(/\//g, '-');
}

// --- Domains ------------------------------------------------------------------------------

/** True when a proxy routes by host name rather than by port. */
function routesByDomain(options: CreateOptions): boolean {
  return options.preset === 'docker' && options.proxy !== 'none';
}

/** The proxied domains without an `http://` prefix, as host names. */
function tlsHosts(options: CreateOptions): string[] {
  return [options.adminDomain, ...(options.publicApi ? [options.publicDomain] : [])]
    .filter((domain) => !domain.startsWith('http://'))
    .map(hostFromDomain);
}

/** nginx terminates TLS for any domain without an `http://` prefix. */
export function nginxUsesTls(options: CreateOptions): boolean {
  return tlsHosts(options).length > 0;
}

/** Origin of the admin and management API. */
export function adminUrl(options: CreateOptions): string {
  if (routesByDomain(options)) return originFromDomain(options.adminDomain);
  return `http://localhost:${options.adminPort}`;
}

/** Origin of the public delivery API. */
export function publicApiUrl(options: CreateOptions): string {
  if (routesByDomain(options)) return originFromDomain(options.publicDomain);
  return `http://localhost:${options.publicPort}`;
}

// --- Mail ---------------------------------------------------------------------------------

/** Each driver's `.env` notes; credentials start blank so boot fails until they are set. */
const MAIL_NOTES: Record<MailDriver, string[]> = {
  smtp: [
    '# Any SMTP server. SMTP_SECURE=true for TLS from the first byte (port 465), false to',
    '# upgrade with STARTTLS (587). SMTP_URL=smtps://user:pass@host:465 replaces all five.',
  ],
  mailpit: ['# Mailpit accepts every mail and shows it in its web inbox. Development only.'],
  gmail: [
    '# A Google mailbox over the Gmail API: an OAuth client of a Google Cloud project with',
    '# the Gmail API enabled, and a refresh token for https://www.googleapis.com/auth/gmail.send.',
  ],
  microsoft: [
    '# A Microsoft 365 mailbox over Microsoft Graph sendMail: an Entra app registration with',
    '# the Mail.Send application permission (admin consent) and a client secret.',
    '# MICROSOFT_SENDER is the mailbox that sends, e.g. cms@contoso.com.',
  ],
  resend: ['# Resend: an API key with sending access; MAIL_FROM on a domain verified there.'],
  sendgrid: [
    '# SendGrid: an API key with Mail Send access; MAIL_FROM a verified sender.',
    '# SENDGRID_REGION=eu for an account on EU data residency.',
  ],
  postmark: ['# Postmark: the server API token; MAIL_FROM a confirmed sender signature.'],
  mailgun: [
    '# Mailgun: a sending API key and the sending domain. MAILGUN_REGION=eu for a domain',
    "# in Mailgun's EU region.",
  ],
};

/** Whether the driver sends from its own mailbox, the default sender. */
function mailboxDriver(mail: CreateOptions['mail']): boolean {
  return mail === 'gmail' || mail === 'microsoft';
}

/** The chosen driver's notes and `.env` variables, as lines. */
function mailDriverEnv(options: CreateOptions): string {
  if (options.mail === 'none') return '';
  const notes = MAIL_NOTES[options.mail];
  const vars = mailVars(options.mail);
  // In Docker, compose.yml sets the Mailpit host; .env only has its UI port.
  const shown =
    options.mail === 'mailpit' && options.preset === 'docker'
      ? vars.filter(([name]) => name === 'MAILPIT_UI_PORT')
      : vars;
  return [...notes, ...shown.map(([name, value]) => `${name}=${value}`)].join('\n');
}

/** The driver's `.env` variables and starting values. */
function mailVars(driver: MailDriver): Array<[string, string]> {
  const vars = MAIL_DRIVER_ENV[driver].flatMap(
    ({ name, example }): Array<[string, string]> =>
      example === undefined ? [] : [[name, example]],
  );
  // Compose reads the Mailpit UI port; the instance does not.
  if (driver === 'mailpit') vars.push(['MAILPIT_UI_PORT', '8025']);
  return vars;
}

/** The README's driver table rows. */
function mailTable(): string {
  return MAIL_DRIVERS.map(
    (driver) =>
      `| \`${driver}\` | ${mailVars(driver)
        .map(([name]) => `\`${name}\``)
        .join(', ')} |`,
  ).join('\n');
}
