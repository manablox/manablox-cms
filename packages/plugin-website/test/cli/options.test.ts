import type { CliInstance, CliPrompter } from '@manablox/core';
import { describe, expect, it } from 'vitest';
import { designsHelp, themesHelp } from '../../src/cli/catalog.js';
import contribution, { DESIGNS_HELP, THEMES_HELP } from '../../src/cli/index.js';

const space = { name: 'Blog', machineName: 'blog', url: 'http://localhost:3200', locales: ['en'] };
const group = contribution.options?.['space create'];
const create = contribution.options?.create;

const instance = (overrides: Partial<CliInstance> = {}): CliInstance => ({
  name: 'my-cms',
  preset: 'local',
  proxy: 'none',
  database: 'postgres',
  publicApi: true,
  byDomain: false,
  adminUrl: 'http://localhost:3000',
  manabloxVersion: '^0.4.0',
  space: { name: 'My site' },
  ...overrides,
});

/** Answers in order; an empty answer takes the default. */
function scripted(answers: string[]): CliPrompter & { asked: string[] } {
  const asked: string[] = [];
  const next = () => answers.shift() ?? '';
  return {
    asked,
    text: async ({ message, defaultValue }) => {
      asked.push(message);
      return next() || defaultValue;
    },
    select: async ({ message, initialValue }) => {
      asked.push(message);
      return (next() || initialValue) as typeof initialValue;
    },
    confirm: async ({ message, initialValue }) => {
      asked.push(message);
      const answer = next();
      return answer ? answer === 'y' : initialValue;
    },
    multiselect: async ({ message, initialValues }) => {
      asked.push(message);
      return initialValues ?? [];
    },
  };
}

describe('website CLI: metadata', () => {
  it('lists the catalog in the help without importing it', () => {
    expect(THEMES_HELP).toEqual(themesHelp());
    expect(DESIGNS_HELP).toEqual(designsHelp());
  });
});

describe('website CLI: space create', () => {
  it('turns --website designed, --theme and --design into the plugin data', async () => {
    expect(await group?.apply(space, {})).toBeUndefined();
    expect(await group?.apply(space, { website: 'external', theme: 'bold' })).toBeUndefined();
    expect(await group?.apply(space, { website: 'designed' })).toEqual({
      theme: 'builtin:neutral',
      preset: 'atlas',
    });
    expect(await group?.apply(space, { website: 'designed', theme: 'bold' })).toEqual({
      theme: 'builtin:bold',
      preset: 'spotlight',
    });
    expect(await group?.apply(space, { website: 'designed', design: 'none' })).toEqual({
      theme: 'builtin:neutral',
      preset: null,
    });
  });

  it('names the option of a bad value before anything runs', async () => {
    await expect(group?.check?.({ website: 'hosted' })).rejects.toThrow(
      "--website must be one of designed, external, not 'hosted'",
    );
    await expect(group?.check?.({ theme: 'pink' })).rejects.toThrow(
      /--theme must be one of neutral, corporate, minimal, practice, bold, studio/,
    );
    await expect(group?.check?.({ design: 'nope' })).rejects.toThrow(
      /--design must be one of atlas/,
    );
  });

  it('reports the look and the domain', () => {
    const data = { theme: 'builtin:bold', preset: null };
    expect(group?.report?.(data, { url: 'https://acme.test/x', warnings: [] })).toEqual([
      'a designed site with the bold theme, answering on acme.test',
    ]);
    expect(
      group?.report?.(
        { theme: 'builtin:bold', preset: 'poster' },
        { url: 'http://x', warnings: ['w'] },
      ),
    ).toEqual(['a designed site with the bold theme and the poster design']);
  });
});

describe('website CLI: create', () => {
  it('takes the defaults without a terminal', async () => {
    const result = await create?.apply({ instance: instance(), prompter: null }, {});
    expect(result?.spaceArgs).toEqual([
      '--website',
      'designed',
      '--theme',
      'neutral',
      '--design',
      'atlas',
    ]);
    expect(result?.spaceUrl).toBe('http://localhost:3200');
    expect(result?.values).toEqual({ sitePort: 3200 });
    expect(result?.nextSteps?.({ started: true })).toEqual([
      'pnpm dev:site                # in another terminal: designed sites at http://localhost:3200',
    ]);
  });

  it('follows the options and the proxy', async () => {
    const docker = instance({ preset: 'docker', proxy: 'caddy', byDomain: true });
    const result = await create?.apply(
      { instance: docker, prompter: null },
      { 'space-theme': 'noir', 'space-design': 'none', 'site-port': '3300' },
    );
    expect(result?.spaceArgs).toEqual([
      '--website',
      'designed',
      '--theme',
      'noir',
      '--design',
      'none',
    ]);
    expect(result?.spaceUrl).toBe('https://www.example.com');
    expect(result?.values).toEqual({ sitePort: 3300 });
    expect(result?.nextSteps?.({ started: false })).toEqual([]);

    const external = await create?.apply(
      { instance: instance(), prompter: null },
      { 'space-website': 'external' },
    );
    expect(external?.spaceArgs).toBeUndefined();
    expect(external?.spaceUrl).toBeUndefined();

    const noSpace = await create?.apply(
      { instance: instance({ space: null }), prompter: null },
      {},
    );
    expect(noSpace?.spaceArgs).toBeUndefined();
  });

  it('asks for the port, the website, the theme and the design', async () => {
    const prompter = scripted(['3201', 'designed', 'editorial', 'none']);
    const result = await create?.apply({ instance: instance(), prompter }, {});
    expect(prompter.asked).toEqual([
      'Port of the site process',
      'How is its website built?',
      'Which theme does the site start with?',
      'Which design does the site start with?',
    ]);
    expect(result?.spaceArgs).toEqual([
      '--website',
      'designed',
      '--theme',
      'editorial',
      '--design',
      'none',
    ]);
    expect(result?.spaceUrl).toBe('http://localhost:3201');

    const behindCaddy = scripted(['external']);
    await create?.apply(
      {
        instance: instance({ preset: 'docker', proxy: 'caddy', byDomain: true }),
        prompter: behindCaddy,
      },
      {},
    );
    expect(behindCaddy.asked).toEqual(['How is its website built?']);
  });

  it("takes every starter theme, studio among them, with its group's first design", async () => {
    await expect(create?.check?.({ 'space-theme': 'studio' })).resolves.toBeUndefined();
    const studio = await create?.apply(
      { instance: instance(), prompter: null },
      { 'space-theme': 'studio' },
    );
    expect(studio?.spaceArgs).toEqual([
      '--website',
      'designed',
      '--theme',
      'studio',
      '--design',
      'spotlight',
    ]);
  });

  it('refuses bad values', async () => {
    await expect(create?.check?.({ 'site-port': '70000' })).rejects.toThrow(
      "--site-port '70000' is not a port",
    );
    await expect(create?.check?.({ 'space-website': 'x' })).rejects.toThrow(
      /--space-website must be one of/,
    );
    await expect(create?.check?.({ 'space-design': 'x' })).rejects.toThrow(
      /--space-design must be one of/,
    );
  });
});

describe('website CLI: templates', () => {
  it('adds the site process, its config, secret and fragments', async () => {
    const parts = await contribution.templates?.({
      instance: instance(),
      values: { sitePort: 3300 },
    });
    expect(parts?.files?.map((file) => file.path)).toEqual(['manablox.site.config.ts']);
    expect(parts?.files?.[0]?.template).toContain("mode: 'website',");
    expect(parts?.tokens).toEqual({
      __SITE_PORT__: '3300',
      __SITE_URL__: 'http://localhost:3300',
    });
    expect(parts?.secrets).toEqual(['__SITE_FORMS_SECRET__']);
    expect(parts?.processes).toEqual([
      { name: 'site', port: 3200, readOnly: true, label: 'the site process' },
    ]);
    expect(parts?.dependencies).toEqual({ '@manablox/plugin-website': '^0.4.0' });
    expect(parts?.slots?.['compose.services']).toContain(
      "command: ['start', '--config', 'manablox.site.config.ts']",
    );
    expect(parts?.slots?.['caddy.sites']).toContain('reverse_proxy site:3200 {');
    expect(parts?.slots?.['nginx.sites']).toContain('proxy_pass http://site:3200;');
    expect(parts?.slots?.env).toContain('SITE_FORMS_SECRET=__SITE_FORMS_SECRET__');

    // The site service of the instance's compose file: reads the uploads, caches media on
    // its own volume, and forwards forms to the API over the compose network.
    const service = parts?.slots?.['compose.services'] ?? '';
    expect(service).toContain('SITE_FORMS_API_URL: http://api:3000');
    expect(service).toContain(`SITE_EDITOR_ORIGIN: \${PUBLIC_URL:?set PUBLIC_URL}`);
    expect(service).toContain('- uploads:/data/uploads:ro');
    expect(service).toContain('- site-media-cache:/data/media-cache');
    expect(parts?.slots?.['compose.volumes']).toBe('  site-media-cache:');

    // The site config: the website mode, forms both ways.
    const siteConfig = parts?.files?.[0]?.template ?? '';
    expect(siteConfig).toContain('forms: { apiUrl: formsApiUrl, secret: formsSecret }');
    expect(siteConfig).toContain('    websitePlugin({');
    // The management instance's plugin takes the same secret.
    expect(parts?.slots?.['config.plugins']).toContain(
      "forms: { secret: envOptional('SITE_FORMS_SECRET') },",
    );

    const byDomain = await contribution.templates?.({
      instance: instance({ preset: 'docker', proxy: 'caddy', byDomain: true }),
      values: { sitePort: 3200 },
    });
    expect(byDomain?.tokens?.__SITE_URL__).toBe('');
  });
});
