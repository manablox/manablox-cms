import { type CliValues, defineCliContribution } from '@manablox/core';

/**
 * Stands in for `@manablox/plugin-website/cli`: a plugin with its own read-only process, a
 * config file for it, a part of every core file, a secret, options of `manablox create`,
 * `manablox space create` and `manablox plugin install`, and commands.
 */

const DEFAULT_SITE_PORT = 3200;
const THEMES = ['neutral', 'bold', 'editorial'];

const text = (value: CliValues[string]) => (typeof value === 'string' ? value : undefined);

function oneOf(option: string, value: string, allowed: readonly string[]): string {
  if (!allowed.includes(value)) throw new Error(`--${option} must be one of ${allowed.join(', ')}`);
  return value;
}

function port(option: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error(`--${option} '${value}' is not a port`);
  return parsed;
}

function sitePortOf(values: CliValues): number | undefined {
  const given = text(values['site-port']);
  return given === undefined ? undefined : port('site-port', given);
}

const siteUrl = (byDomain: boolean, sitePort: number) =>
  byDomain ? '' : `http://localhost:${sitePort}`;

const SITE_CONFIG = `import { defineConfig, envNumber, requireEnv } from '@manablox/core';
import { websitePlugin } from '@manablox/plugin-website';
import { plugins } from './content-model.ts';

export default defineConfig({
{{#if sqlite}}
  database: { url: requireEnv('DATABASE_URL') },
{{#else}}
  database: { url: requireEnv('PUBLIC_DATABASE_URL') },
{{/if}}
  server: { port: envNumber('SITE_PORT', __SITE_PORT__), mode: 'website' },
  auth: { secret: requireEnv('AUTH_SECRET') },
  plugins: [...plugins, websitePlugin()],
});
`;

const COMPOSE_SERVICE = `  site:
    <<: [*cms-image, *logging]
    command: ['start', '--config', 'manablox.site.config.ts']
    restart: unless-stopped
    depends_on:
      migrate: { condition: service_completed_successfully }
{{#if !byDomain}}
    ports:
      - '\${SITE_PORT:-__SITE_PORT__}:3200'
{{/if}}
    environment:
      <<: *cms-env
{{#if !sqlite}}
      DATABASE_URL: postgres://manablox_public:\${POSTGRES_PUBLIC_PASSWORD}@postgres:5432/\${POSTGRES_DB:-manablox}
{{/if}}
      SITE_PORT: '3200'
      SITE_FORMS_SECRET: \${SITE_FORMS_SECRET:-}
{{#if sqlite}}
    volumes:
      - database:/data/db
{{/if}}
`;

const ENV = `# --- Designed sites ---
{{#if byDomain}}
SITE_URL=
{{/if}}
{{#if ports}}
SITE_PORT=__SITE_PORT__
SITE_URL=__SITE_URL__
{{/if}}
{{#if local}}
SITE_PORT=__SITE_PORT__
SITE_URL=__SITE_URL__
SITE_FORMS_API_URL=__ADMIN_URL__
{{/if}}
SITE_FORMS_SECRET=__SITE_FORMS_SECRET__
`;

export default defineCliContribution({
  summary: 'designed websites, served by the site process',
  options: {
    'space create': {
      options: [
        { name: 'website', arg: 'designed|external', help: 'designed: a designed site' },
        { name: 'theme', arg: '<id>', help: `the starter theme: ${THEMES.join(', ')}` },
      ],
      check: (values) => {
        oneOf('website', text(values.website) ?? 'external', ['designed', 'external']);
        oneOf('theme', text(values.theme) ?? 'neutral', THEMES);
      },
      apply: (_space, values) =>
        text(values.website) === 'designed'
          ? { theme: `builtin:${text(values.theme) ?? 'neutral'}`, preset: null }
          : undefined,
      report: (data) => [
        `a designed site with the ${(data as { theme: string }).theme.replace('builtin:', '')} theme`,
      ],
    },
    create: {
      options: [
        {
          name: 'space-website',
          arg: 'designed|external',
          help: [
            'designed: a theme, served by the site process',
            '(default); external: your own frontend',
          ],
        },
        {
          name: 'space-theme',
          arg: '<id>',
          help: `designed: the starter theme: ${THEMES.join(', ')}`,
        },
        {
          name: 'site-port',
          arg: '<port>',
          help: 'without a proxy: the site process port (default: 3200)',
        },
      ],
      check: (values) => {
        const website = text(values['space-website']);
        if (website !== undefined) oneOf('space-website', website, ['designed', 'external']);
        const theme = text(values['space-theme']);
        if (theme !== undefined) oneOf('space-theme', theme, THEMES);
        sitePortOf(values);
      },
      apply: async ({ instance, prompter }, values) => {
        let sitePort = sitePortOf(values);
        if (sitePort === undefined && prompter && !instance.byDomain) {
          sitePort = port(
            'site-port',
            await prompter.text({ message: 'Port of the site process', defaultValue: '3200' }),
          );
        }
        sitePort ??= DEFAULT_SITE_PORT;
        let website = text(values['space-website']);
        if (website === undefined && instance.space && prompter) {
          website = await prompter.select({
            message: 'How is its website built?',
            options: [
              { value: 'designed', label: 'Designed site' },
              { value: 'external', label: 'Own frontend' },
            ],
            initialValue: 'designed',
          });
        }
        let theme = text(values['space-theme']);
        if (theme === undefined && website === 'designed' && prompter) {
          theme = await prompter.select({
            message: 'Which theme does the site start with?',
            options: THEMES.map((value) => ({ value, label: value })),
            initialValue: 'neutral',
          });
        }
        const designed = instance.space !== null && (website ?? 'designed') === 'designed';
        const url = siteUrl(instance.byDomain, sitePort);
        return {
          ...(designed
            ? {
                spaceArgs: ['--website', 'designed', '--theme', theme ?? 'neutral'],
                spaceUrl: instance.byDomain ? 'https://www.example.com' : url,
              }
            : {}),
          nextSteps: () =>
            instance.preset === 'local'
              ? [`pnpm dev:site                # designed sites at ${url}`]
              : [],
          values: { sitePort },
        };
      },
    },
  },
  commands: {
    'publish-all': {
      description: 'publish every design draft of a space',
      options: [{ name: 'space', arg: '<name>', help: 'the space' }],
      run: async (context) => {
        context.out.write('published\n');
        return 0;
      },
    },
  },
  templates: ({ instance, values }) => {
    const sitePort = (values as { sitePort?: number } | undefined)?.sitePort ?? DEFAULT_SITE_PORT;
    const plugin = '  websitePlugin(),';
    const imports = "import { websitePlugin } from '@manablox/plugin-website';";
    return {
      files: [{ path: 'manablox.site.config.ts', template: SITE_CONFIG }],
      tokens: {
        __SITE_PORT__: String(sitePort),
        __SITE_URL__: siteUrl(instance.byDomain, sitePort),
      },
      secrets: ['__SITE_FORMS_SECRET__'],
      processes: [{ name: 'site', port: 3200, readOnly: true, label: 'the site process' }],
      dependencies: { '@manablox/plugin-website': instance.manabloxVersion },
      slots: {
        'config.imports': imports,
        'config.plugins': plugin,
        'public.imports': imports,
        'public.plugins': plugin,
        'package.start': '    "start:site": "manablox start --config manablox.site.config.ts",',
        'package.dev':
          '{{#if local}}\n    "dev:site": "manablox start --watch --config manablox.site.config.ts",\n{{/if}}',
        env: ENV,
        'compose.header': '#   site      designed sites',
        'compose.services': COMPOSE_SERVICE,
        'compose.proxy': '      - site',
        'compose.volumes': '  site-media-cache:',
        'caddy.header': '#\n# Every other host goes to the site process.',
        'caddy.global': '\ton_demand_tls {\n\t\task http://site:3200/_manablox/domain-check\n\t}',
        'caddy.admin': '\trespond /plugins/website/forms/* 404',
        'caddy.sites':
          'https:// {\n\ttls {\n\t\ton_demand\n\t}\n\treverse_proxy site:3200 {\n\t\theader_up Host {host}\n\t}\n}\n',
        'nginx.admin': '    location /plugins/website/forms/ {\n        return 404;\n    }',
        'nginx.sites':
          'server {\n    listen 80 default_server;\n    location / {\n        proxy_pass http://site:3200;\n    }\n}\n',
        'readme.sections':
          '## Designed sites\n\n{{#if local}}\n`pnpm dev:site` starts the site process.\n{{#else}}\nThe `site` service serves them.\n{{/if}}\n',
        'readme.security': '- The site process reads with the read-only role.\n',
      },
    };
  },
  install: async ({ instance, prompter, values }) => {
    for (const name of ['space-website', 'space-theme']) {
      if (values[name] !== undefined)
        throw new Error(
          `--${name} is about the first space of manablox create; plugin install makes none`,
        );
    }
    let sitePort = sitePortOf(values);
    if (sitePort === undefined && prompter && !instance.byDomain) {
      sitePort = port(
        'site-port',
        await prompter.text({ message: 'Port of the site process', defaultValue: '3200' }),
      );
    }
    sitePort ??= DEFAULT_SITE_PORT;
    const url = siteUrl(instance.byDomain, sitePort);
    return {
      values: { sitePort },
      nextSteps:
        instance.preset === 'local'
          ? [`pnpm dev:site                # designed sites at ${url}`]
          : [],
    };
  },
});
