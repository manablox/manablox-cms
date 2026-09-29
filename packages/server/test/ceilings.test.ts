import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AdminBanner,
  definePlugin,
  type FeatureControl,
  type FeatureKey,
} from '@manablox/core';
import { INSTANCE_ID_META_KEY } from '@manablox/db';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  bootstrap,
  type ManagementRuntime,
  type Runtime,
  requireManagement,
} from '../src/bootstrap.js';

const KEY = 'ceilings-control-key-0123456789';

/** What the plugin's services hold; the ceiling reads it, as a license plugin would. */
interface CappedState {
  version: number;
  features: Map<FeatureKey, FeatureControl>;
  banners: AdminBanner[];
}

const states: CappedState[] = [];
const seenIds: string[] = [];

const capped = definePlugin<CappedState>({
  name: 'capped',
  services: () => {
    const state: CappedState = { version: 0, features: new Map(), banners: [] };
    states.push(state);
    return state;
  },
  ceilings: (plugin) => {
    seenIds.push(plugin.manablox.instance.id);
    return {
      features: () => plugin.services.features,
      version: () => plugin.services.version,
      banners: () => plugin.services.banners,
    };
  },
});

const locked: FeatureControl = {
  enabled: false,
  presentation: 'locked',
  message: 'The capped plugin needs a license',
  link: 'https://buy.test/capped',
};

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let pub: Runtime;
let app: Hono;
let spaceId: string;
let apiKey: string;

const control = (path: string, init: { method?: string; body?: unknown } = {}) =>
  app.request(`/control/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const me = async () => {
  const response = await app.request('/api/v1/users/me', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: '{}',
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, any>;
};

/** Sets every process's ceiling. */
const cap = (features: Record<string, FeatureControl>, banners: AdminBanner[] = []) => {
  for (const state of states) {
    state.features = new Map(Object.entries(features)) as Map<FeatureKey, FeatureControl>;
    state.banners = banners;
    state.version++;
  }
};

beforeAll(async () => {
  db = await createTestDatabase('server_ceilings');
  dir = await mkdtemp(join(tmpdir(), 'manablox-ceilings-'));
  const config = {
    database: { url: db.url },
    auth: { secret: 'ceilings-secret' },
    fieldTypes: builtinFieldTypes,
    plugins: [capped],
    logLevel: 'silent' as const,
    storage: { driver: 'local' as const, local: { path: join(dir, 'files') } },
  };
  api = requireManagement(
    await bootstrap({
      ...config,
      server: { rateLimit: false, scopes: ['rpc', 'auth', 'control'] },
      control: { apiKey: KEY },
    }),
  );
  app = await createApp(api);
  pub = await bootstrap({ ...config, server: { mode: 'public', rateLimit: false } });

  const admin = await api.repos.users.create({
    name: 'Admin',
    email: 'admin@ceilings.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  apiKey = (await api.apiKeys.issue(admin.id, 'ceilings')).key;
  spaceId = (
    await api.repos.spaces.create({
      name: 'Capped',
      machineName: 'capped',
      url: 'https://capped.test',
      defaultLocale: 'en',
      locales: ['en'],
    })
  ).id;
}, 60_000);

afterAll(async () => {
  await pub?.shutdown();
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('the instance id', () => {
  it('is made once and is the same in every process and boot', async () => {
    const { id } = api.manablox.instance;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(pub.manablox.instance.id).toBe(id);
    expect(await api.repos.instanceMeta.get(INSTANCE_ID_META_KEY)).toBe(id);
    // The plugins' ceilings are made with it known.
    expect(seenIds).toEqual([id, id]);
  });
});

describe('feature ceilings', () => {
  it('are wired in every mode and switch a plugin off in each process', async () => {
    expect(states).toHaveLength(2);
    expect(await api.manablox.plugins.isOn('capped', spaceId)).toBe(true);
    expect(await pub.manablox.plugins.isOn('capped', spaceId)).toBe(true);

    cap({ 'plugins.capped': locked });
    expect(await api.manablox.plugins.isOn('capped', spaceId)).toBe(false);
    expect(await pub.manablox.plugins.isOn('capped', null)).toBe(false);
    await expect(
      api.manablox.controls.assertFeature(spaceId, 'plugins.capped'),
    ).rejects.toMatchObject({ key: 'control.feature' });

    // A stored value cannot switch it back on.
    const patched = await control(`/settings?scope=space:${spaceId}`, {
      method: 'PATCH',
      body: { 'features.plugins.capped': { enabled: true } },
    });
    expect(patched.status).toBe(200);
    expect(await api.manablox.plugins.isOn('capped', spaceId)).toBe(false);

    cap({});
    expect(await api.manablox.plugins.isOn('capped', spaceId)).toBe(true);
  });

  it('show read-only in the control API, which cannot write them', async () => {
    cap({ 'plugins.capped': locked, approvals: { enabled: false } });
    const all = (await (await control('/settings')).json()) as Record<string, any>;
    expect(all.ceilings).toEqual({
      'features.plugins.capped': locked,
      'features.approvals': { enabled: false },
    });
    const scoped = (await (await control('/settings?scope=instance')).json()) as Record<
      string,
      any
    >;
    expect(scoped).toMatchObject({ scope: 'instance', ceilings: all.ceilings });

    const write = await control('/settings?scope=ceiling', {
      method: 'PATCH',
      body: { 'features.approvals': { enabled: true } },
    });
    expect(write.status).toBe(400);
    expect(((await write.json()) as Record<string, any>).error.key).toBe('control.scope.invalid');

    const report = (await (await control('/state')).json()) as Record<string, any>;
    expect(report.scopes[0].featuresOff).toEqual(expect.arrayContaining(['approvals']));
    cap({});
  });

  it('reach the admin session: its features and banners', async () => {
    const banner: AdminBanner = {
      id: 'capped.payment',
      level: 'warning',
      text: 'The payment failed',
      link: 'https://buy.test/billing',
      dismissible: true,
      audience: 'all',
    };
    cap({ 'plugins.capped': locked }, [banner]);
    const { controls } = await me();
    expect(controls.features['plugins.capped']).toEqual({
      presentation: 'locked',
      message: 'The capped plugin needs a license',
      link: 'https://buy.test/capped',
    });
    expect(controls.banners).toEqual([banner]);
    cap({});
    expect((await me()).controls.features['plugins.capped']).toBeUndefined();
  });
});
