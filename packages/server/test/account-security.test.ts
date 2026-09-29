import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MailTransport } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrap, type ManagementRuntime, requireManagement } from '../src/bootstrap.js';

const KEY = 'account-security-key-0123456789';
const ADMIN = 'http://admin.security.test';
const PASSWORD = 'security-password-123';

let db: TestDatabase;
let dir: string;
let runtime: ManagementRuntime;
let app: Hono;
let spaceId: string;
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
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (!value || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  get header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

let ipSeq = 0;
const headers = (jar: Jar) => ({
  'content-type': 'application/json',
  origin: ADMIN,
  'x-forwarded-for': `203.0.113.${(++ipSeq % 250) + 1}`,
  ...(jar.header ? { cookie: jar.header } : {}),
});

/** better-auth's endpoints. */
const auth = async (jar: Jar, path: string, body: unknown = {}) =>
  jar.keep(
    await app.request(`/api/auth/${path}`, {
      method: 'POST',
      headers: headers(jar),
      body: JSON.stringify(body),
    }),
  );

/** A management procedure over REST. */
const rest = async (jar: Jar, path: string, body: unknown = {}) =>
  jar.keep(
    await app.request(`/api/v1/${path}`, {
      method: 'POST',
      headers: headers(jar),
      body: JSON.stringify(body),
    }),
  );

const control = (path: string, method: string, body?: unknown) =>
  app.request(`/control/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const json = async (response: Response) => (await response.json()) as Record<string, any>;

async function setControls(values: Record<string, unknown>) {
  expect((await control('/settings?scope=instance', 'PATCH', values)).status).toBeLessThan(300);
  runtime.controlStore.forget(null);
}

async function clearControl(key: string) {
  await control(`/settings/${key}?scope=instance`, 'DELETE');
  runtime.controlStore.forget(null);
}

let seq = 0;
async function account(options: { role?: 'superadmin' | 'editor'; spaceRole?: string } = {}) {
  seq += 1;
  const user = await runtime.users.create({
    name: `Person ${seq}`,
    email: `person-${seq}@security.test`,
    password: PASSWORD,
    role: options.role ?? 'editor',
  });
  if (options.spaceRole) await runtime.spaces.grant(spaceId, user.id, options.spaceRole);
  return user;
}

async function signedIn(email: string): Promise<Jar> {
  const jar = new Jar();
  const response = await auth(jar, 'sign-in/email', { email, password: PASSWORD });
  expect(response.status).toBe(200);
  return jar;
}

/** RFC 4648 base32, as in an `otpauth://` URI. */
function base32Decode(input: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes).toString('utf8');
}

/** A current code, from better-auth's own generator. */
async function totp(uri: string): Promise<string> {
  const secret = base32Decode(new URL(uri).searchParams.get('secret') ?? '');
  const api = runtime.auth.api as unknown as {
    generateTOTP(input: { body: { secret: string } }): Promise<{ code: string }>;
  };
  return (await api.generateTOTP({ body: { secret } })).code;
}

/** Turns two-factor on for a signed-in browser; returns the URI and backup codes. */
async function enrol(jar: Jar) {
  const enabled = await auth(jar, 'two-factor/enable', { password: PASSWORD });
  expect(enabled.status).toBe(200);
  const { totpURI, backupCodes } = await json(enabled);
  const verified = await auth(jar, 'two-factor/verify-totp', { code: await totp(totpURI) });
  expect(verified.status).toBe(200);
  return { uri: totpURI as string, backupCodes: backupCodes as string[] };
}

const linkIn = (text: string, path: string) =>
  text.split('\n').find((line) => line.startsWith(`${ADMIN}${path}`)) ?? '';

async function actions(userId: string) {
  const page = await runtime.repos.audit.pageByTarget({ kind: 'user', id: userId });
  return page.items.map((entry) => entry.action);
}

beforeAll(async () => {
  db = await createTestDatabase('server_account_security');
  dir = await mkdtemp(join(tmpdir(), 'manablox-account-security-'));
  runtime = requireManagement(
    await bootstrap({
      database: { url: db.url },
      auth: { secret: 'account-security-secret-0123456789', trustedOrigins: [ADMIN] },
      fieldTypes: builtinFieldTypes,
      logLevel: 'silent',
      storage: { driver: 'local', local: { path: join(dir, 'files') } },
      server: { adminUrl: ADMIN, rateLimit: false, scopes: ['rpc', 'auth', 'control'] },
      control: { apiKey: KEY },
      mail: { transport },
    }),
  );
  app = await createApp(runtime);
  const space = await runtime.repos.spaces.create({
    name: 'Secure',
    machineName: 'secure',
    url: 'https://secure.test',
    defaultLocale: 'en',
    locales: ['en'],
  });
  spaceId = space.id;
}, 60_000);

afterEach(async () => {
  await runtime.twoFactor.setPolicy('off');
  for (const key of ['features.twoFactor', 'auth.requireEmailVerification']) {
    await clearControl(key);
  }
  await runtime.passwordResets.settle();
  sent.length = 0;
});

afterAll(async () => {
  await runtime?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('two-factor authentication', () => {
  it('enrols with TOTP, then asks for a code at sign-in', async () => {
    const user = await account();
    const jar = await signedIn(user.email);
    const { uri } = await enrol(jar);
    expect((await runtime.repos.users.findById(user.id))?.twoFactorEnabled).toBe(true);
    const me = await json(await rest(jar, 'users/me'));
    expect(me.twoFactor).toMatchObject({ enabled: true, pending: false });

    const next = new Jar();
    const first = await auth(next, 'sign-in/email', { email: user.email, password: PASSWORD });
    expect(await json(first)).toMatchObject({ twoFactorRedirect: true });
    expect((await rest(next, 'users/me')).status).toBe(401);

    const wrong = await auth(next, 'two-factor/verify-totp', { code: '000000' });
    expect(wrong.status).toBe(401);
    const right = await auth(next, 'two-factor/verify-totp', { code: await totp(uri) });
    expect(right.status).toBe(200);
    expect((await json(await rest(next, 'users/me'))).id).toBe(user.id);
    expect(await actions(user.id)).toContain('user.enableTwoFactor');
  });

  it('signs in with a backup code once', async () => {
    const user = await account();
    const { backupCodes } = await enrol(await signedIn(user.email));
    const code = backupCodes[0] as string;

    const jar = new Jar();
    await auth(jar, 'sign-in/email', { email: user.email, password: PASSWORD });
    expect((await auth(jar, 'two-factor/verify-backup-code', { code })).status).toBe(200);
    expect((await rest(jar, 'users/me')).status).toBe(200);

    const again = new Jar();
    await auth(again, 'sign-in/email', { email: user.email, password: PASSWORD });
    expect((await auth(again, 'two-factor/verify-backup-code', { code })).status).toBe(401);
  });

  it('mails a notice when backup codes are regenerated', async () => {
    const user = await account();
    const jar = await signedIn(user.email);
    await enrol(jar);
    sent.length = 0;
    const response = await auth(jar, 'two-factor/generate-backup-codes', { password: PASSWORD });
    expect(response.status).toBe(200);
    expect((await json(response)).backupCodes).toHaveLength(10);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual([user.email]);
    expect(sent[0]?.subject).toMatch(/backup codes/i);
    expect(linkIn(sent[0]?.text ?? '', '/profile')).toBeTruthy();
    expect(await actions(user.id)).toContain('user.regenerateBackupCodes');
  });

  it('refuses enrolment while the feature is off and keeps existing second steps', async () => {
    const enrolled = await account();
    const { uri } = await enrol(await signedIn(enrolled.email));
    await setControls({ 'features.twoFactor': { enabled: false } });

    const user = await account();
    const jar = await signedIn(user.email);
    const refused = await auth(jar, 'two-factor/enable', { password: PASSWORD });
    expect(refused.status).toBe(403);
    expect(await json(refused)).toMatchObject({ code: 'FEATURE_OFF' });
    expect((await json(await rest(jar, 'users/me'))).twoFactor).toMatchObject({
      available: false,
      enabled: false,
    });

    const next = new Jar();
    const first = await auth(next, 'sign-in/email', { email: enrolled.email, password: PASSWORD });
    expect(await json(first)).toMatchObject({ twoFactorRedirect: true });
    expect((await auth(next, 'two-factor/verify-totp', { code: await totp(uri) })).status).toBe(
      200,
    );
  });
});

describe('the two-factor policy', () => {
  it('holds covered accounts at enrolment until they enrol', async () => {
    const owner = await account({ spaceRole: 'owner' });
    const editor = await account({ spaceRole: 'editor' });
    await runtime.twoFactor.setPolicy('admins');

    const jar = await signedIn(owner.email);
    const me = await json(await rest(jar, 'users/me'));
    expect(me.twoFactor).toMatchObject({ pending: true, required: true, enabled: false });
    expect(me.spaces).toEqual({});
    const refused = await rest(jar, 'spaces/list');
    expect(refused.status).toBe(403);
    expect((await json(refused)).error).toMatchObject({ key: 'auth.twoFactor.enrolmentRequired' });
    expect((await rest(jar, 'preferences/get', { key: 'banners.dismissed' })).status).toBe(200);

    const other = await signedIn(editor.email);
    expect((await json(await rest(other, 'users/me'))).twoFactor.pending).toBe(false);
    expect((await rest(other, 'spaces/list')).status).toBe(200);

    await enrol(jar);
    const after = await json(await rest(jar, 'users/me'));
    expect(after.twoFactor).toMatchObject({ pending: false, enabled: true, required: true });
    expect(after.spaces).toEqual({ [spaceId]: 'owner' });
    expect((await rest(jar, 'spaces/list')).status).toBe(200);

    const disable = await auth(jar, 'two-factor/disable', { password: PASSWORD });
    expect(disable.status).toBe(403);
    expect(await json(disable)).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
  });

  it('covers everyone under `all`, and nobody while the feature is off', async () => {
    const editor = await account();
    await runtime.twoFactor.setPolicy('all');
    const jar = await signedIn(editor.email);
    expect((await json(await rest(jar, 'users/me'))).twoFactor.pending).toBe(true);

    await setControls({ 'features.twoFactor': { enabled: false } });
    expect((await json(await rest(jar, 'users/me'))).twoFactor.pending).toBe(false);
    expect(await runtime.twoFactor.settings()).toMatchObject({
      policy: 'all',
      effective: 'off',
      available: false,
    });
  });

  it('is a superadmin setting that needs the feature', async () => {
    const admin = await account({ role: 'superadmin' });
    const editor = await account();
    const jar = await signedIn(admin.email);
    const set = await rest(jar, 'instance/updateSettings', { twoFactorPolicy: 'admins' });
    expect(set.status).toBe(200);
    expect((await json(set)).twoFactor).toMatchObject({ policy: 'admins', effective: 'admins' });
    expect((await rest(await signedIn(editor.email), 'instance/settings')).status).toBe(403);

    // The admin itself is now covered and must enrol first.
    await enrol(jar);
    await setControls({ 'features.twoFactor': { enabled: false } });
    const refused = await rest(jar, 'instance/updateSettings', { twoFactorPolicy: 'all' });
    expect((await json(refused)).error).toMatchObject({
      key: 'auth.twoFactor.policyNeedsFeature',
    });
    expect((await rest(jar, 'instance/updateSettings', { twoFactorPolicy: 'off' })).status).toBe(
      200,
    );
  });
});

describe('email confirmation', () => {
  it('confirms a changed address before it applies', async () => {
    const user = await account();
    const jar = await signedIn(user.email);
    const response = await rest(jar, 'users/updateProfile', { email: 'Moved@Security.test' });
    const body = await json(response);
    expect(body.email).toBe(user.email);
    expect(body.emailChange).toEqual({ status: 'sent', email: 'moved@security.test' });
    expect(sent[0]?.to).toEqual(['moved@security.test']);

    const link = linkIn(sent[0]?.text ?? '', '/verify-email');
    const token = new URL(link).searchParams.get('token') as string;
    const stored = await runtime.handle.db.select().from(runtime.handle.tables.verifications);
    const row = stored.find((entry) => entry.value.includes(user.id));
    expect(row?.identifier).toMatch(/^verify-email:[0-9a-f]{64}$/);
    expect(stored.some((entry) => `${entry.identifier}${entry.value}`.includes(token))).toBe(false);

    const confirmed = await rest(new Jar(), 'users/verifyEmail', { token });
    expect(await json(confirmed)).toEqual({ email: 'moved@security.test' });
    expect(await runtime.repos.users.findById(user.id)).toMatchObject({
      email: 'moved@security.test',
      emailVerified: true,
    });
    const again = await rest(new Jar(), 'users/verifyEmail', { token });
    expect((await json(again)).error).toMatchObject({ key: 'auth.email.tokenInvalid' });
    expect(await actions(user.id)).toEqual(
      expect.arrayContaining(['user.requestEmailChange', 'user.update']),
    );
  });

  it('keeps unconfirmed accounts from signing in while the control asks for it', async () => {
    const user = await account();
    await setControls({ 'auth.requireEmailVerification': true });

    const jar = new Jar();
    const refused = await auth(jar, 'sign-in/email', { email: user.email, password: PASSWORD });
    expect(refused.status).toBe(403);
    expect(await json(refused)).toMatchObject({ message: 'auth.email.unverified' });
    expect((await rest(jar, 'users/me')).status).toBe(401);
    expect(sent).toHaveLength(1);

    const token = new URL(linkIn(sent[0]?.text ?? '', '/verify-email')).searchParams.get('token');
    expect((await rest(new Jar(), 'users/verifyEmail', { token })).status).toBe(200);
    expect((await runtime.repos.users.findById(user.id))?.emailVerified).toBe(true);
    const allowed = await auth(new Jar(), 'sign-in/email', {
      email: user.email,
      password: PASSWORD,
    });
    expect(allowed.status).toBe(200);
  });

  it('lets unconfirmed accounts in while the control is off', async () => {
    const user = await account();
    expect((await runtime.repos.users.findById(user.id))?.emailVerified).toBe(false);
    expect(
      (await auth(new Jar(), 'sign-in/email', { email: user.email, password: PASSWORD })).status,
    ).toBe(200);
  });
});

describe('preferences', () => {
  it('stores banner dismissals per account', async () => {
    const one = await signedIn((await account()).email);
    const two = await signedIn((await account()).email);
    expect(await json(await rest(one, 'preferences/get', { key: 'banners.dismissed' }))).toEqual({
      key: 'banners.dismissed',
      value: null,
    });
    const set = await rest(one, 'preferences/set', { key: 'banners.dismissed', value: ['a', 'b'] });
    expect(set.status).toBe(200);
    expect(
      (await json(await rest(one, 'preferences/get', { key: 'banners.dismissed' }))).value,
    ).toEqual(['a', 'b']);
    expect(
      (await json(await rest(two, 'preferences/get', { key: 'banners.dismissed' }))).value,
    ).toBeNull();
    expect((await rest(one, 'preferences/set', { key: 'theme', value: 'dark' })).status).toBe(422);
    expect(
      (await rest(one, 'preferences/set', { key: 'banners.dismissed', value: 'a' })).status,
    ).toBe(422);
  });
});
