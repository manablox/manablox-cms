import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashInvitationToken } from '@manablox/auth';
import type { MailTransport } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrap, type ManagementRuntime, requireManagement } from '../src/bootstrap.js';

const KEY = 'invitations-key-0123456789abcdef';
const ADMIN = 'http://admin.invite.test';
const PASSWORD = 'invite-password-123';

let db: TestDatabase;
let dir: string;
let runtime: ManagementRuntime;
let plain: ManagementRuntime;
let app: Hono;
let plainApp: Hono;
let spaceA: string;
let spaceB: string;
let root: Jar;
let spaceAdmin: Jar;
let editor: Jar;
const sent: Array<{ to: string[]; subject: string; text: string }> = [];

const transport: MailTransport = {
  name: 'test',
  send: async (message) => {
    sent.push({ to: message.to, subject: message.subject, text: message.text });
    return { id: null };
  },
};

/** Cookies of one browser. */
class Jar {
  private readonly cookies = new Map<string, string>();

  keep(response: Response): Response {
    for (const line of response.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const at = pair.indexOf('=');
      const value = pair.slice(at + 1).trim();
      if (!value || /max-age=0/i.test(line)) this.cookies.delete(pair.slice(0, at).trim());
      else this.cookies.set(pair.slice(0, at).trim(), value);
    }
    return response;
  }

  get header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

let ipSeq = 0;
const call = async (target: Hono, jar: Jar, path: string, body: unknown = {}) =>
  jar.keep(
    await target.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ADMIN,
        'x-forwarded-for': `192.0.2.${(++ipSeq % 250) + 1}`,
        ...(jar.header ? { cookie: jar.header } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

const rest = (jar: Jar, path: string, body: unknown = {}, target: Hono = app) =>
  call(target, jar, `/api/v1/${path}`, body);

const json = async (response: Response) => (await response.json()) as Record<string, any>;

const control = async (path: string, method: string, body?: unknown) => {
  const response = await app.request(`/control/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  for (const target of [runtime, plain]) target.controlStore.forget(null);
  return response;
};

async function signIn(email: string, target: Hono = app): Promise<Jar> {
  const jar = new Jar();
  const response = await call(target, jar, '/api/auth/sign-in/email', {
    email,
    password: PASSWORD,
  });
  expect(response.status).toBe(200);
  return jar;
}

let seq = 0;
async function account(spaceRole?: { spaceId: string; role: string }) {
  seq += 1;
  const user = await runtime.users.create({
    name: `Member ${seq}`,
    email: `member-${seq}@invite.test`,
    password: PASSWORD,
    role: 'editor',
  });
  if (spaceRole) await runtime.spaces.grant(spaceRole.spaceId, user.id, spaceRole.role);
  return user;
}

let emailSeq = 0;
const newEmail = () => `guest-${++emailSeq}@invite.test`;

const tokenIn = (text: string) => {
  const line = text.split('\n').find((row) => row.startsWith(`${ADMIN}/accept-invite`)) ?? '';
  return new URL(line).searchParams.get('token') as string;
};

async function invite(jar: Jar, email: string, grants: unknown[], target: Hono = app) {
  sent.length = 0;
  const response = await rest(jar, 'invitations/create', { email, grants }, target);
  expect(response.status).toBe(200);
  const body = await json(response);
  const token = body.link
    ? new URL(body.link).searchParams.get('token')
    : tokenIn(sent[0]?.text ?? '');
  return { id: body.invitation.id as string, token: token as string, body };
}

const accept = (
  token: string,
  jar = new Jar(),
  details: object = { name: 'Guest', password: PASSWORD },
) => rest(jar, 'invitations/accept', { token, ...details });

async function eventsSince(seq: number) {
  return (await runtime.repos.controlEvents.listAfter(seq, 100)).map((row) => row.type);
}

beforeAll(async () => {
  db = await createTestDatabase('server_invitations');
  dir = await mkdtemp(join(tmpdir(), 'manablox-invitations-'));
  const config = (mail: boolean) => ({
    database: { url: db.url },
    auth: { secret: 'invitations-secret-0123456789abcdef', trustedOrigins: [ADMIN] },
    fieldTypes: builtinFieldTypes,
    logLevel: 'silent' as const,
    storage: { driver: 'local' as const, local: { path: join(dir, 'files') } },
    server: {
      adminUrl: ADMIN,
      rateLimit: false as const,
      scopes: ['rpc', 'auth', 'control'] as never,
    },
    control: { apiKey: KEY },
    mail: mail ? { transport } : {},
  });
  runtime = requireManagement(await bootstrap(config(true)));
  plain = requireManagement(await bootstrap(config(false)));
  app = await createApp(runtime);
  plainApp = await createApp(plain);

  const space = (name: string) =>
    runtime.repos.spaces.create({
      name,
      machineName: name.toLowerCase(),
      url: `https://${name.toLowerCase()}.test`,
      defaultLocale: 'en',
      locales: ['en'],
    });
  spaceA = (await space('Alpha')).id;
  spaceB = (await space('Beta')).id;

  const admin = await runtime.users.create({
    name: 'Root',
    email: 'root@invite.test',
    password: PASSWORD,
    role: 'superadmin',
  });
  void admin;
  root = await signIn('root@invite.test');
  spaceAdmin = await signIn((await account({ spaceId: spaceA, role: 'admin' })).email);
  editor = await signIn((await account({ spaceId: spaceA, role: 'editor' })).email);
}, 60_000);

afterEach(async () => {
  for (const scope of ['instance', `space:${spaceA}`]) {
    await control(`/settings/limits.seats?scope=${scope}`, 'DELETE');
  }
  sent.length = 0;
});

afterAll(async () => {
  await plain?.shutdown();
  await runtime?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('inviting', () => {
  it('mails a link, stores only its hash, and sets up the account on accept', async () => {
    const email = newEmail();
    const { id, token, body } = await invite(root, email.toUpperCase(), [
      { spaceId: spaceA, role: 'editor' },
      { spaceId: spaceB, role: 'viewer' },
    ]);
    expect(body.link).toBeNull();
    expect(body.invitation).toMatchObject({ email, status: 'pending' });
    expect(sent[0]?.to).toEqual([email]);
    expect(sent[0]?.text).toContain('Alpha and Beta');

    const row = await runtime.repos.invitations.findById(id);
    expect(row?.tokenHash).toBe(hashInvitationToken(token));
    expect(JSON.stringify(row)).not.toContain(token);

    const preview = await json(await rest(new Jar(), 'invitations/preview', { token }));
    expect(preview).toMatchObject({ email, accountExists: false, inviter: 'Root' });
    expect(preview.spaces.map((space: { name: string }) => space.name).sort()).toEqual([
      'Alpha',
      'Beta',
    ]);

    const before = await runtime.repos.controlEvents.latestSeq();
    const accepted = await accept(token);
    expect(accepted.status).toBe(200);
    expect(await json(accepted)).toMatchObject({ email, created: true });

    const user = await runtime.repos.users.findByEmail(email);
    expect(user).toMatchObject({ name: 'Guest', role: 'editor', emailVerified: true });
    expect(await runtime.repos.users.findSpaceRole(user?.id as string, spaceA)).toBe('editor');
    expect(await runtime.repos.users.findSpaceRole(user?.id as string, spaceB)).toBe('viewer');
    expect(await eventsSince(before)).toEqual(
      expect.arrayContaining(['user.created', 'seat.changed']),
    );
    await signIn(email);

    const again = await accept(token);
    expect((await json(again)).error).toMatchObject({ key: 'invitation.invalid' });
    const list = await json(await rest(root, 'invitations/list'));
    expect(list.find((entry: { id: string }) => entry.id === id)?.status).toBe('accepted');
  });

  it('returns a copyable link when the instance cannot mail', async () => {
    const jar = await signIn('root@invite.test', plainApp);
    const email = newEmail();
    const { token, body } = await invite(
      jar,
      email,
      [{ spaceId: spaceA, role: 'author' }],
      plainApp,
    );
    expect(body.link).toMatch(new RegExp(`^${ADMIN}/accept-invite\\?token=`));
    expect(sent).toHaveLength(0);
    expect((await accept(token)).status).toBe(200);
    expect((await runtime.repos.users.findByEmail(email))?.emailVerified).toBe(true);
  });

  it('refuses expired, revoked and resent links', async () => {
    const expired = await invite(root, newEmail(), [{ spaceId: spaceA, role: 'editor' }]);
    await runtime.repos.invitations.renew(
      expired.id,
      hashInvitationToken(expired.token),
      new Date(Date.now() - 1000),
    );
    expect((await json(await accept(expired.token))).error).toMatchObject({
      key: 'invitation.expired',
    });
    const list = await json(await rest(root, 'invitations/list', { spaceId: spaceA }));
    expect(list.find((entry: { id: string }) => entry.id === expired.id)?.status).toBe('expired');

    const revoked = await invite(root, newEmail(), [{ spaceId: spaceA, role: 'editor' }]);
    expect((await rest(root, 'invitations/revoke', { id: revoked.id })).status).toBe(200);
    expect((await json(await accept(revoked.token))).error).toMatchObject({
      key: 'invitation.invalid',
    });

    const resent = await invite(root, newEmail(), [{ spaceId: spaceA, role: 'editor' }]);
    sent.length = 0;
    const again = await rest(root, 'invitations/resend', { id: resent.id });
    expect(again.status).toBe(200);
    const fresh = tokenIn(sent[0]?.text ?? '');
    expect(fresh).not.toBe(resent.token);
    expect((await json(await accept(resent.token))).error).toMatchObject({
      key: 'invitation.invalid',
    });
    expect((await accept(fresh)).status).toBe(200);
  });

  it('lets space admins invite into their spaces only', async () => {
    const own = await rest(spaceAdmin, 'invitations/create', {
      email: newEmail(),
      grants: [{ spaceId: spaceA, role: 'editor' }],
    });
    expect(own.status).toBe(200);
    const { id } = (await json(own)).invitation;

    const other = await rest(spaceAdmin, 'invitations/create', {
      email: newEmail(),
      grants: [{ spaceId: spaceB, role: 'editor' }],
    });
    expect(other.status).toBe(403);
    const none = await rest(spaceAdmin, 'invitations/create', { email: newEmail(), grants: [] });
    expect((await json(none)).error.details[0]).toMatchObject({
      key: 'invitation.grants.required',
    });
    const unknownRole = await rest(spaceAdmin, 'invitations/create', {
      email: newEmail(),
      grants: [{ spaceId: spaceA, role: 'wizard' }],
    });
    expect((await json(unknownRole)).error.details[0]).toMatchObject({
      key: 'invitation.role.unknown',
    });
    expect(
      (
        await rest(editor, 'invitations/create', {
          email: newEmail(),
          grants: [{ spaceId: spaceA, role: 'editor' }],
        })
      ).status,
    ).toBe(403);

    const mixed = await invite(root, newEmail(), [
      { spaceId: spaceA, role: 'editor' },
      { spaceId: spaceB, role: 'editor' },
    ]);
    expect((await rest(spaceAdmin, 'invitations/revoke', { id: mixed.id })).status).toBe(404);
    expect((await rest(spaceAdmin, 'invitations/list')).status).toBe(403);
    const listed = await json(await rest(spaceAdmin, 'invitations/list', { spaceId: spaceA }));
    expect(listed.map((entry: { id: string }) => entry.id)).toEqual(
      expect.arrayContaining([id, mixed.id]),
    );
    expect((await rest(spaceAdmin, 'invitations/revoke', { id })).status).toBe(200);
  });
});

describe('seats', () => {
  it('refuses an invitation that could not be accepted today', async () => {
    const members = await runtime.repos.limitCounts.seats([spaceA]);
    await control(`/settings?scope=space:${spaceA}`, 'PATCH', {
      'limits.seats': { max: members },
    });
    const refused = await rest(root, 'invitations/create', {
      email: newEmail(),
      grants: [{ spaceId: spaceA, role: 'editor' }],
    });
    expect((await json(refused)).error).toMatchObject({ key: 'control.limit' });

    const users = await runtime.repos.users.count();
    await control('/settings?scope=instance', 'PATCH', { 'limits.seats': { max: users } });
    const instance = await rest(root, 'invitations/create', { email: newEmail(), grants: [] });
    expect((await json(instance)).error).toMatchObject({ key: 'control.limit' });
  });

  it('checks the space seats again on accept and changes nothing when refused', async () => {
    const email = newEmail();
    const { id, token } = await invite(root, email, [{ spaceId: spaceA, role: 'editor' }]);
    await account({ spaceId: spaceA, role: 'viewer' });
    const members = await runtime.repos.limitCounts.seats([spaceA]);
    await control(`/settings?scope=space:${spaceA}`, 'PATCH', {
      'limits.seats': { max: members },
    });

    const refused = await accept(token);
    expect((await json(refused)).error).toMatchObject({ key: 'control.limit' });
    expect(await runtime.repos.users.findByEmail(email)).toBeNull();
    expect((await runtime.repos.invitations.findById(id))?.acceptedAt).toBeNull();

    await control(`/settings/limits.seats?scope=space:${spaceA}`, 'DELETE');
    expect((await accept(token)).status).toBe(200);
  });
});

describe('an address that has an account', () => {
  it('asks to sign in with it and attaches the grants', async () => {
    const existing = await account();
    const { token } = await invite(root, existing.email, [{ spaceId: spaceB, role: 'author' }]);
    const preview = await json(await rest(new Jar(), 'invitations/preview', { token }));
    expect(preview.accountExists).toBe(true);

    expect((await json(await accept(token))).error).toMatchObject({
      key: 'invitation.signInRequired',
    });
    const wrong = await accept(token, editor, {});
    expect((await json(wrong)).error).toMatchObject({ key: 'invitation.emailMismatch' });

    const jar = await signIn(existing.email);
    const accepted = await accept(token, jar, {});
    expect(await json(accepted)).toMatchObject({ created: false, userId: existing.id });
    expect(await runtime.repos.users.findSpaceRole(existing.id, spaceB)).toBe('author');
  });
});
