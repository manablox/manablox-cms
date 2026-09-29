import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'vitest/config';
import {
  graphqlTestConfig,
  pluginAdminTestConfig,
  pluginTestConfig,
  sharedConfig,
} from '../src/index.js';

describe('sharedConfig', () => {
  it('runs test/**/*.test.ts in node, with a cache under the running package', () => {
    expect(sharedConfig.test).toMatchObject({
      environment: 'node',
      include: ['test/**/*.test.ts'],
      env: { NODE_ENV: 'test' },
      unstubGlobals: true,
      unstubEnvs: true,
      fsModuleCachePath: 'node_modules/.vitest-cache',
    });
  });
});

describe('pluginTestConfig', () => {
  it('leaves test/admin out and gives suites more time', () => {
    const config = pluginTestConfig();
    expect(config.test?.testTimeout).toBe(60_000);
    expect(config.test?.exclude).toContain('test/admin/**');
    expect(config.test?.include).toEqual(['test/**/*.test.ts']);
  });
});

describe('pluginAdminTestConfig', () => {
  it('runs only test/admin, in happy-dom, with the given plugins', () => {
    const vue: Plugin = { name: 'vue' };
    const config = pluginAdminTestConfig([vue]);
    expect(config.test?.environment).toBe('happy-dom');
    expect(config.test?.include).toEqual(['test/admin/**/*.test.ts']);
    expect(config.plugins?.flat()).toContainEqual(vue);
  });

  it("adds adminSfcTypes() of the testing package's @manablox/admin-plugin", async () => {
    const cwd = vi
      .spyOn(process, 'cwd')
      .mockReturnValue(fileURLToPath(new URL('../../plugin-workflows', import.meta.url)));
    const plugins = await Promise.all(pluginAdminTestConfig([]).plugins?.flat() ?? []);
    cwd.mockRestore();
    expect(plugins.flat().map((plugin) => (plugin as Plugin | undefined)?.name)).toContain(
      'manablox:admin-sfc-types',
    );
  });
});

describe('graphqlTestConfig', () => {
  it("aliases graphql to the ESM build that the calling package's dependency resolves", () => {
    const config = graphqlTestConfig(
      new URL('../../api-graphql/package.json', import.meta.url).href,
    );
    const aliases = config.resolve?.alias as { find: RegExp; replacement: string }[];
    expect(aliases[0]?.find.test('graphql')).toBe(true);
    expect(aliases[0]?.replacement).toMatch(/graphql[\\/]index\.mjs$/);
  });
});
