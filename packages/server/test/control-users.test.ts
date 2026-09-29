import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type MailTransport, ManabloxError } from '@manablox/core';
import { PROVISIONED_META_KEY } from '@manablox/db';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrap, type ManagementRuntime, requireManagement } from '../src/bootstrap.js';

const KEY = 'control-users-key-0123456789';
const ADMIN = 'http://admin.test';
const OWNER = { email: 'Owner@Example.test', name: 'Ada Owner' };

let db: TestDatabase;
let signUpDb: TestDatabase;
let dir: string;
let runtime: ManagementRuntime;
let app: Hono;
let spaceId: string;
const others: ManagementRuntime[] = [];
const sent: Array<{ to: string[]; text: string }> = [];

const transport: MailTransport = {
  name: 'test',
  send: async (message) => {
    sent.push({ to: message.to, text: message.text });
    return { id: null };
  },
};

const config = (url: string, overrides: Record<string, unknown> = {}) => ({
  database: { url },
  auth: { secret: 'control-users-secret', trustedOrigins: [ADMIN] },
  fieldTypes: builtinFieldTypes,
  logLevel: 'silent',
  storage: { driver: 'local' as const, local: { path: join(dir, 'files') } },
  server: { adminUrl: ADMIN, rateLimit: false, scopes: ['rpc', 'auth', 'control'] },
  control: { apiKey: KEY },
  ...overrides,
});

const start = async (url: string, overrides: Record<string, unknown> = {}) => {
  const started = requireManagement(await bootstrap(config(url, overrides) as never));
  others.push(started);
  return started;
};

const control = (
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) =>
  app.request(`/control/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

let ipSeq = 0;
const authCall = (target: Hono, path: string, body: unknown) =>
  target.request(`/api/auth/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ADMIN,
      'x-forwarded-for': `198.51.100.${++ipSeq}`,
    },
    body: JSON.stringify(body),
  });

const json = async (response: Response) => (await response.json()) as Record<string, any>;
const tokenOf = (url: string) => new URL(url).searchParams.get('token');

beforeAll(async () => {
  db = await createTestDatabase('server_control_users');
  signUpDb = await createTestDatabase('server_control_signup');
  dir = await mkdtemp(join(tmpdir(), 'manablox-control-users-'));
  runtime = requireManagement(await bootstrap(config(db.url, { mail: { transport } }) as never));
  app = await createApp(runtime);
  spaceId = (
    await runtime.spaces.create(
      { name: 'Main', machineName: 'main', url: 'https://main.test' },
      null,
    )
  ).id;
});

afterAll(async () => {
  for (const other of others) await other.shutdown();
  await runtime?.shutdown();
  await db?.drop();
  await signUpDb?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('POST /users/owner', () => {
  it('creates nothing when a grant is refused', async () => {
    const off = runtime.manablox.hooks.on('member:beforeGrant', () => {
      throw ManabloxError.badRequest('request.invalid', { reason: 'seats' });
    });
    try {
      const refused = await control('/users/owner', { method: 'POST', body: OWNER });
      expect(refused.status).toBe(400);
    } finally {
      off();
    }
    expect(await runtime.repos.users.count()).toBe(0);
    expect(await runtime.repos.instanceMeta.get(PROVISIONED_META_KEY)).toBeNull();
    expect(await runtime.users.setupNeeded()).toBe(true);
  });

  it('creates the superadmin as owner of every space and returns a link', async () => {
    sent.length = 0;
    const response = await control('/users/owner', {
      method: 'POST',
      body: { ...OWNER, sendMail: true, expiresIn: 3600 },
      headers: { 'idempotency-key': 'owner-1' },
    });
    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body.user).toMatchObject({
      email: 'owner@example.test',
      name: 'Ada Owner',
      role: 'superadmin',
      banned: false,
      memberships: 1,
      lastSignInAt: null,
    });
    expect(body.setPasswordLink.url.startsWith(`${ADMIN}/reset-password?token=`)).toBe(true);
    const expiresIn = new Date(body.setPasswordLink.expiresAt).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(3500_000);
    expect(expiresIn).toBeLessThanOrEqual(3600_000);
    expect(body.mailSent).toBe(true);
    // The set-password mail only; the space grant is told in the admin.
    await runtime.notifications.settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain('/reset-password?token=');
    expect(sent[0]?.to).toEqual(['owner@example.test']);
    const told = await runtime.repos.notifications.countUnread(body.user.id);
    expect(told).toBe(1);

    expect(await runtime.repos.users.findSpaceRole(body.user.id, spaceId)).toBe('owner');

    const replay = await control('/users/owner', {
      method: 'POST',
      body: { ...OWNER, sendMail: true, expiresIn: 3600 },
      headers: { 'idempotency-key': 'owner-1' },
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect((await json(replay)).user.id).toBe(body.user.id);

    const created = await runtime.repos.audit.page({
      actions: ['user.create', 'member.grant', 'user.requestPasswordReset'],
      targetId: body.user.id,
    });
    expect(created.items.map((entry) => entry.action).sort()).toEqual([
      'member.grant',
      'user.create',
      'user.requestPasswordReset',
      'user.requestPasswordReset',
    ]);
    expect(created.items.every((entry) => entry.actorKind === 'control')).toBe(true);
  });

  it('makes the instance provisioned', async () => {
    expect(await runtime.users.provisioned()).toBe(true);
    expect(await runtime.users.setupNeeded()).toBe(false);
  });

  it('refuses a second owner', async () => {
    const response = await control('/users/owner', {
      method: 'POST',
      body: { email: 'second@example.test', name: 'Second' },
    });
    expect(response.status).toBe(409);
    expect((await json(response)).error.key).toBe('control.owner.exists');
    expect(await runtime.repos.users.count()).toBe(1);
  });
});

describe('set-password links', () => {
  it('redeems the link; the owner then signs in', async () => {
    const [owner] = await runtime.repos.users.listByRole('superadmin');
    // The external layer provides the address, so no confirmation is asked.
    expect(owner?.emailVerified).toBe(true);
    const required = await control('/settings?scope=instance', {
      method: 'PATCH',
      body: { 'auth.requireEmailVerification': true },
    });
    expect(required.status).toBeLessThan(300);
    runtime.controlStore.forget(null);
    const link = await json(
      await control(`/users/${owner?.id}/reset-link`, { method: 'POST', body: {} }),
    );
    expect(link.mailSent).toBe(false);
    const reset = await authCall(app, 'reset-password', {
      token: tokenOf(link.setPasswordLink.url),
      newPassword: 'owner-password-123',
    });
    expect(reset.status).toBe(200);
    const signIn = await authCall(app, 'sign-in/email', {
      email: 'owner@example.test',
      password: 'owner-password-123',
    });
    expect(signIn.status).toBe(200);
    expect(sent.some((mail) => mail.text.includes('/verify-email'))).toBe(false);
    await control('/settings/auth.requireEmailVerification?scope=instance', { method: 'DELETE' });
    runtime.controlStore.forget(null);
  });

  it('answers 404 for unknown accounts', async () => {
    const unknown = await control('/users/00000000-0000-4000-8000-000000000000/reset-link', {
      method: 'POST',
    });
    expect(unknown.status).toBe(404);
    expect((await json(unknown)).error.key).toBe('user.notFound');
    expect((await control('/users/nope/reset-link', { method: 'POST' })).status).toBe(404);
  });
});

describe('GET /users and revoke-sessions', () => {
  it('lists accounts with memberships and last sign-in', async () => {
    await runtime.users.create({
      name: 'Editor',
      email: 'editor@example.test',
      password: 'editor-password-123',
      role: 'editor',
    });
    const body = await json(await control('/users'));
    expect(body.items).toHaveLength(2);
    const [owner, editor] = body.items;
    expect(owner).toMatchObject({
      email: 'owner@example.test',
      role: 'superadmin',
      memberships: 1,
    });
    expect(typeof owner.lastSignInAt).toBe('string');
    expect(Number.isNaN(Date.parse(owner.lastSignInAt))).toBe(false);
    expect(editor).toMatchObject({
      email: 'editor@example.test',
      role: 'editor',
      memberships: 0,
      lastSignInAt: null,
      banned: false,
    });
  });

  it('signs an account out everywhere, audited as the control API', async () => {
    const [owner] = await runtime.repos.users.listByRole('superadmin');
    const id = owner?.id ?? '';
    const response = await control(`/users/${id}/revoke-sessions`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ revoked: true });
    const listed = (await json(await control('/users'))).items.find(
      (user: { id: string }) => user.id === id,
    );
    expect(listed.lastSignInAt).toBeNull();
    const audit = await runtime.repos.audit.page({
      actions: ['user.revokeSessions'],
      targetId: id,
    });
    expect(audit.items[0]).toMatchObject({ actorKind: 'control' });
  });
});

describe('sign-up', () => {
  const plain = { server: { adminUrl: ADMIN, rateLimit: false, scopes: ['rpc', 'auth'] } };
  let provisioned: ManagementRuntime;
  let selfHosted: ManagementRuntime;

  beforeAll(async () => {
    provisioned = await start(signUpDb.url, { ...plain, control: { provisioned: true } });
    selfHosted = await start(signUpDb.url, { ...plain, control: {} });
  });

  it('is closed with CONTROL_PROVISIONED and there is no setup', async () => {
    expect(await provisioned.users.setupNeeded()).toBe(false);
    expect(await selfHosted.users.setupNeeded()).toBe(true);
    const response = await authCall(await createApp(provisioned), 'sign-up/email', {
      email: 'first@example.test',
      password: 'first-password-123',
      name: 'First',
    });
    expect(response.status).toBe(403);
    expect(await provisioned.repos.users.count()).toBe(0);
  });

  it('does not promote a sole account at start when provisioned', async () => {
    const user = await provisioned.users.create({
      name: 'Sole',
      email: 'sole@example.test',
      password: 'sole-password-123',
      role: 'editor',
    });
    await start(signUpDb.url, { ...plain, control: { provisioned: true } });
    expect((await provisioned.repos.users.findById(user.id))?.role).toBe('editor');

    // Self-hosted keeps promoting it.
    await start(signUpDb.url, { ...plain, control: {} });
    expect((await provisioned.repos.users.findById(user.id))?.role).toBe('superadmin');
  });

  it('lets the first account sign up and promotes it when self-hosted', async () => {
    const fresh = await createTestDatabase('server_control_selfhosted');
    try {
      const own = await start(fresh.url, { ...plain, control: {} });
      const response = await authCall(await createApp(own), 'sign-up/email', {
        email: 'first@example.test',
        password: 'first-password-123',
        name: 'First',
      });
      expect(response.status).toBe(200);
      const [first] = await own.repos.users.listByRole('superadmin');
      expect(first?.email).toBe('first@example.test');
      expect(await own.users.setupNeeded()).toBe(false);
      await own.shutdown();
      others.splice(others.indexOf(own), 1);
    } finally {
      await fresh.drop();
    }
  });
});
