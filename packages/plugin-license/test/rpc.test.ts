import { decryptSecret } from '@manablox/core/node';
import { keyId } from '@manablox/license';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LicenseKeyView, LicenseOverview } from '../src/sdk.js';
import { licenseRepos } from '../src/server/db/index.js';
import { bootLicense, type LicenseInstance } from './helpers/boot.js';

const SECRET = 'license-plugin-secret-0123456789';

let target: LicenseInstance;
let superadmin: string;
let editor: string;

/** A procedure of `plugins.license` over REST, as an API key. */
const call = async (procedure: string, body: unknown, apiKey?: string) => {
  const response = await target.app.request(`/api/v1/plugins/license/${procedure}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
};

beforeAll(async () => {
  target = await bootLicense('rpc', { license: () => ({ kind: 'production' }) });
  const { repos, apiKeys } = target.api;
  const admin = await repos.users.create({
    name: 'Admin',
    email: 'admin@license.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  superadmin = (await apiKeys.issue(admin.id, 'licenses')).key;
  const user = await repos.users.create({
    name: 'Editor',
    email: 'editor@license.test',
    role: 'editor',
    passwordHash: 'x',
  });
  editor = (await apiKeys.issue(user.id, 'licenses')).key;
}, 60_000);

afterAll(async () => {
  await target?.close();
});

describe('Settings → Licenses over rpc', () => {
  it('answers superadmins only', async () => {
    expect((await call('overview', {})).status).toBe(401);
    const refused = await call('overview', {}, editor);
    expect(refused.status).toBe(403);
    const addRefused = await call('addKey', { key: target.server.addKey() }, editor);
    expect(addRefused.status).toBe(403);
    expect(await licenseRepos(target.api.repos).list()).toEqual([]);

    const overview = await call('overview', {}, superadmin);
    expect(overview.status).toBe(200);
    expect(overview.body as LicenseOverview).toEqual({
      keys: [],
      products: [expect.objectContaining({ product: 'ai', label: 'AI', state: 'missing' })],
      portal: 'https://licenses.test',
      managed: false,
    });
  });

  it('adds a key encrypted with the instance secret, and audits it by its id', async () => {
    const key = target.server.addKey();
    const added = await call('addKey', { key }, superadmin);
    expect(added.status).toBe(200);
    expect(added.body as LicenseKeyView).toMatchObject({
      keyId: keyId(key),
      source: 'admin',
      state: 'active',
      activated: true,
      products: [
        { product: 'ai', label: 'AI' },
        { product: 'website', label: 'Website' },
      ],
    });
    const [row] = await licenseRepos(target.api.repos).list();
    expect(row?.keyEnc).toEqual(expect.any(String));
    expect(row?.keyEnc).not.toContain(key);
    expect(row?.keyEnc).not.toContain(key.slice(4));
    expect(decryptSecret(row?.keyEnc ?? '', SECRET)).toBe(key);
    expect(() => decryptSecret(row?.keyEnc ?? '', 'another-secret-0123456789')).toThrow();

    const entries = await target.api.repos.audit.page({ targetKind: 'license.key' });
    expect(entries.items.map((entry) => [entry.action, entry.targetLabel])).toEqual([
      ['license.key.add', keyId(key)],
    ]);
    expect(JSON.stringify(entries.items)).not.toContain(key);

    const duplicate = await call('addKey', { key }, superadmin);
    expect(duplicate).toMatchObject({
      status: 409,
      body: {
        error: { key: 'plugins.license.key.duplicate', message: 'This key is added already.' },
      },
    });
  });

  it('refreshes, deactivates and removes, auditing what changed', async () => {
    const [row] = await licenseRepos(target.api.repos).list();
    const id = row?.id ?? '';
    expect((await call('refresh', { id }, superadmin)).status).toBe(200);
    const deactivated = await call('deactivate', { id }, superadmin);
    expect(deactivated.body).toMatchObject({ deactivated: true, activated: false });
    expect((await call('activate', { id }, superadmin)).body).toMatchObject({ activated: true });
    expect((await call('removeKey', { id }, superadmin)).body).toEqual({ ok: true });
    expect(await licenseRepos(target.api.repos).list()).toEqual([]);
    const missing = await call('refresh', { id }, superadmin);
    expect(missing.status).toBe(404);

    const entries = await target.api.repos.audit.page({ targetKind: 'license.key' });
    expect(entries.items.map((entry) => entry.action)).toEqual([
      'license.key.remove',
      'license.key.activate',
      'license.key.deactivate',
      'license.key.add',
    ]);
  });
});
