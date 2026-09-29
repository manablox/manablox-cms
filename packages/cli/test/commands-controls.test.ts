import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const applyPlan = vi.fn(async () => []);
const runtime = {
  manablox: { controls: { feature: vi.fn(async () => ({ enabled: false })) } },
  repos: {
    spaces: { findByMachineName: vi.fn(async () => null) },
    users: { count: vi.fn(async () => 0), page: vi.fn(async () => ({ items: [] })) },
  },
  spaces: {
    create: vi.fn(async () => ({
      id: 's1',
      name: 'Blog',
      machineName: 'blog',
      warnings: [] as string[],
    })),
  },
  codeResources: { sync: vi.fn(async () => {}) },
  contentTypes: { using: vi.fn(() => ({ applyPlan })) },
  users: {
    create: vi.fn(async () => ({ id: 'u1', role: 'superadmin', email: 'first@example.test' })),
  },
  shutdown: vi.fn(async () => {}),
};
const ownEverySpace = vi.fn(async () => {});

vi.mock('@manablox/server', () => ({
  loadConfig: async () => ({ config: { server: {} } }),
  bootstrap: async () => runtime,
  requireManagement: (value: unknown) => value,
}));
vi.mock('@manablox/auth', async (original) => ({
  ...(await original<typeof import('@manablox/auth')>()),
  ownEverySpace,
}));

import { parseArgs } from '../src/args.js';
import { space } from '../src/commands/space.js';
import { user } from '../src/commands/user.js';
import { firstPartyPlugins } from '../src/plugins.js';
import { tempDirs } from './helpers/temp-dir.js';

const tempDir = tempDirs('manablox-space-');
const plugins = () => firstPartyPlugins(process.cwd());

let stderr: string[];
beforeEach(() => {
  stderr = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MANABLOX_USER_PASSWORD;
});

describe('CLI commands and controls', () => {
  it('space create refuses while spaceCreate is off', async () => {
    expect(await space(parseArgs(['space', 'create', '--name', 'Blog']))).toBe(1);
    expect(runtime.manablox.controls.feature).toHaveBeenCalledWith(null, 'spaceCreate');
    expect(runtime.spaces.create).not.toHaveBeenCalled();
    expect(stderr.join('')).toContain('features.spaceCreate');
  });

  it('space create hands --plugin-data to the plugins', async () => {
    runtime.manablox.controls.feature.mockResolvedValueOnce({ enabled: true });
    const args = parseArgs([
      'space',
      'create',
      '--name',
      'Blog',
      '--plugin-data',
      'hello={"greeting":"Hi"}',
      '--plugin-data',
      'acme.seo={"index":false}',
    ]);
    expect(await space(args)).toBe(0);
    expect(runtime.spaces.create).toHaveBeenCalledWith(
      expect.objectContaining({
        machineName: 'blog',
        plugins: { hello: { greeting: 'Hi' }, 'acme.seo': { index: false } },
      }),
      null,
      undefined,
      expect.any(Function),
    );
  });

  it("space create hands a plugin's options to it and reports its part", async () => {
    runtime.manablox.controls.feature.mockResolvedValueOnce({ enabled: true });
    runtime.spaces.create.mockResolvedValueOnce({
      id: 's2',
      name: 'Site',
      machineName: 'site',
      warnings: ['The site could not use localhost: taken.'],
    });
    const out: string[] = [];
    vi.mocked(process.stdout.write).mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    const loaded = await plugins();
    const args = parseArgs(
      ['space', 'create', '--name', 'Site', '--website', 'designed', '--theme', 'bold'],
      loaded,
    );
    expect(await space(args, loaded)).toBe(0);
    expect(runtime.spaces.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ plugins: { website: { theme: 'builtin:bold', preset: null } } }),
      null,
      undefined,
      expect.any(Function),
    );
    expect(out.join('')).toContain('a designed site with the bold theme\n');
    expect(out.join('')).toContain('The site could not use localhost');
  });

  it('space create refuses the website twice', async () => {
    runtime.manablox.controls.feature.mockResolvedValueOnce({ enabled: true });
    const loaded = await plugins();
    const args = parseArgs(
      ['space', 'create', '--name', 'Site', '--website', 'designed', '--plugin-data', 'website={}'],
      loaded,
    );
    await expect(space(args, loaded)).rejects.toThrow(
      "--website and --plugin-data website=... both give the website plugin's data; use one",
    );
    // An own frontend sends no data, so --plugin-data alone decides.
    runtime.manablox.controls.feature.mockResolvedValueOnce({ enabled: true });
    const external = parseArgs(
      ['space', 'create', '--name', 'Site', '--website', 'external', '--plugin-data', 'website={}'],
      loaded,
    );
    expect(await space(external, loaded)).toBe(0);
    expect(runtime.spaces.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ plugins: { website: {} } }),
      null,
      undefined,
      expect.any(Function),
    );
  });

  it('space create applies a --plan after the template', async () => {
    runtime.manablox.controls.feature.mockResolvedValueOnce({ enabled: true });
    const dir = tempDir();
    const plan = {
      types: [{ name: 'article', kind: 'content', fields: [{ name: 'title', type: 'text' }] }],
    };
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
    const args = parseArgs(['space', 'create', '--name', 'Blog', '--plan', join(dir, 'plan.json')]);
    expect(await space(args)).toBe(0);
    const fill = (runtime.spaces.create.mock.calls.at(-1) as unknown[] | undefined)?.[2] as (
      row: { id: string },
      repos: unknown,
    ) => Promise<void>;
    await fill({ id: 's1' }, { tx: true });
    expect(runtime.contentTypes.using).toHaveBeenCalledWith({ tx: true });
    expect(applyPlan).toHaveBeenCalledWith('s1', expect.objectContaining(plan), null);

    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ types: [] }));
    await expect(
      space(parseArgs(['space', 'create', '--name', 'Blog', '--plan', join(dir, 'bad.json')])),
    ).rejects.toThrow(/--plan: .*bad\.json is not a content type plan\n {2}types:/);
    writeFileSync(join(dir, 'broken.json'), '{');
    await expect(
      space(parseArgs(['space', 'create', '--name', 'Blog', '--plan', join(dir, 'broken.json')])),
    ).rejects.toThrow(/is not JSON/);
    await expect(
      space(parseArgs(['space', 'create', '--name', 'Blog', '--plan', join(dir, 'none.json')])),
    ).rejects.toThrow(/--plan: cannot read/);
  });

  it('space create names the details of a refusal', async () => {
    runtime.manablox.controls.feature.mockResolvedValueOnce({ enabled: true });
    runtime.spaces.create.mockRejectedValueOnce(
      Object.assign(new Error('contentType.validation.failed'), {
        details: [{ key: 'field.name.reserved', path: ['types', 0, 'fields', 0, 'name'] }],
      }),
    );
    await expect(space(parseArgs(['space', 'create', '--name', 'Blog']))).rejects.toThrow(
      'contentType.validation.failed\n  types.0.fields.0.name: field.name.reserved',
    );
  });

  it('user create grants the first account every space through the hooks', async () => {
    process.env.MANABLOX_USER_PASSWORD = 'first-password-123';
    expect(await user(parseArgs(['user', 'create', '--email', 'first@example.test']))).toBe(0);
    expect(ownEverySpace).toHaveBeenCalledWith(runtime.manablox, runtime.repos, 'u1');
  });
});
