import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliTemplateContext, CliTemplates } from '@manablox/core';
import { DEFAULT_SITE_PORT, siteUrl, type WebsiteCreateValues } from './create.js';

/** The fragment files: beside this module in the sources, under `cli/templates` in the build. */
function templatesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const found = [join(here, 'templates'), join(here, 'cli', 'templates')].find((dir) =>
    existsSync(join(dir, 'env')),
  );
  if (!found) throw new Error('the website plugin is missing its CLI templates');
  return found;
}

function read(name: string): string {
  return readFileSync(join(templatesDir(), name), 'utf8');
}

const IMPORT = "import { websitePlugin } from '@manablox/plugin-website';";

const MANAGEMENT_PLUGIN = `  websitePlugin({
    // The website process (manablox.site.config.ts), which the admin frames for the design canvas.
    url: envOptional('SITE_URL'),
    // Accepts the website process's form submissions at /plugins/website/forms/submit.
    forms: { secret: envOptional('SITE_FORMS_SECRET') },
  }),`;

const PUBLIC_PLUGIN = `  // Delivers each block's \`design\` for designed sites.
  websitePlugin(),`;

const CADDY_HEADER = `#
# Every other host goes to the site process. Its certificates are issued on demand, on
# the first request, and only for domains the site process says it knows: the domains
# added to a space in the admin.`;

const CADDY_GLOBAL = `	on_demand_tls {
		ask http://site:3200/_manablox/domain-check
	}`;

const CADDY_ADMIN = `	# Only the website process posts here, over the internal network.
	respond /plugins/website/forms/* 404`;

const NGINX_ADMIN = `    # Only the website process posts here, over the internal network.
    location /plugins/website/forms/ {
        return 404;
    }`;

/** Docker and local variants of one slot. */
function byPreset(docker: string, local: string): string {
  return `{{#if docker}}\n${docker}{{#else}}\n${local}{{/if}}\n`;
}

/** The site process, its config and its part of the core files. */
export function websiteTemplates({ instance, values }: CliTemplateContext): CliTemplates {
  // `manablox plugin uninstall` asks for the parts without values.
  const sitePort = (values as WebsiteCreateValues | undefined)?.sitePort ?? DEFAULT_SITE_PORT;
  return {
    files: [{ path: 'manablox.site.config.ts', template: read('site-config.ts.template') }],
    tokens: {
      __SITE_PORT__: String(sitePort),
      __SITE_URL__: siteUrl(instance.byDomain, sitePort),
    },
    secrets: ['__SITE_FORMS_SECRET__'],
    processes: [{ name: 'site', port: 3200, readOnly: true, label: 'the site process' }],
    dependencies: { '@manablox/plugin-website': instance.manabloxVersion },
    slots: {
      'config.imports': IMPORT,
      'config.plugins': MANAGEMENT_PLUGIN,
      'public.imports': IMPORT,
      'public.plugins': PUBLIC_PLUGIN,
      'package.start': '    "start:site": "manablox start --config manablox.site.config.ts",',
      'package.dev':
        '{{#if local}}\n    "dev:site": "manablox start --watch --config manablox.site.config.ts",\n{{/if}}',
      env: read('env'),
      'compose.header':
        '#   site      designed sites, one process for every space and domain{{#if byDomain}}, served at every other host{{#else}}, published on SITE_PORT{{/if}}',
      'compose.services': read('compose-service.yml'),
      'compose.proxy': '      - site',
      'compose.volumes': '  site-media-cache:',
      'caddy.header': CADDY_HEADER,
      'caddy.global': CADDY_GLOBAL,
      'caddy.admin': CADDY_ADMIN,
      'caddy.sites': read('caddy-sites.caddy'),
      'nginx.admin': NGINX_ADMIN,
      'nginx.sites': read('nginx-sites.conf'),
      'readme.sections': byPreset(read('readme-docker.md'), read('readme-local.md')),
      'readme.security': read('readme-docker-security.md'),
    },
  };
}
