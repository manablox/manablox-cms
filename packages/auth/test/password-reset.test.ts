import type { ManabloxConfig } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import {
  createDatabase,
  createRepositories,
  type DatabaseHandle,
  type Repositories,
} from '@manablox/db';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type AuthMailer,
  createAuth,
  type ManabloxAuth,
  PasswordResetService,
  UserService,
} from '../src/index.js';

const ADMIN_URL = 'http://admin.test';
const PASSWORD = 'old-password-123';

interface Sent {
  to: string[];
  subject: string;
  text: string;
}

let database: TestDatabase;
let handle: DatabaseHandle;
let repos: Repositories;
let manablox: Manablox;

beforeAll(async () => {
  database = await createTestDatabase('auth_reset');
  handle = await createDatabase({ url: database.url, max: 4 });
  manablox = new Manablox({
    database: { url: database.url },
    auth: { secret: 'test-secret-for-reset' },
    logLevel: 'silent',
  } as ManabloxConfig);
  await manablox.init();
  repos = createRepositories(handle, manablox.contentTypes);
});

afterAll(async () => {
  await handle?.close();
  await database?.drop();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A fresh auth instance. */
function setup(options: { mail?: boolean } = {}) {
  const sent: Sent[] = [];
  const mailer: AuthMailer | null =
    options.mail === false
      ? null
      : {
          send: async (message) => {
            sent.push(message);
          },
        };
  const resets = new PasswordResetService(manablox, repos, { mailer, adminUrl: ADMIN_URL });
  const auth = createAuth({ secret: 'test-secret-for-reset', baseUrl: 'http://api.test' }, handle, {
    passwordResets: resets,
  });
  return { auth, resets, sent };
}

let seq = 0;
async function createUser() {
  seq += 1;
  return new UserService(repos).create({
    name: `Reset ${seq}`,
    email: `reset-${seq}-${Date.now()}@example.test`,
    password: PASSWORD,
    role: 'editor',
  });
}

function tokenOf(url: string): string {
  const parsed = new URL(url);
  expect(`${parsed.origin}${parsed.pathname}`).toBe(`${ADMIN_URL}/reset-password`);
  const token = parsed.searchParams.get('token');
  expect(token).toBeTruthy();
  return token as string;
}

function linkIn(mail: Sent): string {
  const line = mail.text.split('\n').find((row) => row.startsWith(ADMIN_URL));
  expect(line).toBeDefined();
  return line as string;
}

/** The session token, or `null` when refused. */
async function signIn(auth: ManabloxAuth, email: string, password: string) {
  try {
    return (await auth.api.signInEmail({ body: { email, password } })).token;
  } catch {
    return null;
  }
}

async function sessionOf(auth: ManabloxAuth, token: string) {
  return auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) });
}

const reset = (auth: ManabloxAuth, token: string, newPassword = 'new-password-456') =>
  auth.api.resetPassword({ body: { token, newPassword } });

async function auditActions(userId: string) {
  const page = await repos.audit.pageByTarget({ kind: 'user', id: userId });
  return page.items.map((entry) => ({ action: entry.action, meta: entry.meta }));
}

describe('password reset by mail', () => {
  it('mails a one-time link that sets a new password and signs out everywhere', async () => {
    const { auth, resets, sent } = setup();
    const user = await createUser();
    const session = await signIn(auth, user.email, PASSWORD);
    expect(session).toBeTruthy();
    expect(await sessionOf(auth, session as string)).not.toBeNull();

    await auth.api.requestPasswordReset({ body: { email: user.email } });
    await resets.settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual([user.email]);
    expect(sent[0]?.subject).toBe('Reset your Manablox password');
    const token = tokenOf(linkIn(sent[0] as Sent));

    await reset(auth, token);
    expect(await sessionOf(auth, session as string)).toBeNull();
    expect(await signIn(auth, user.email, PASSWORD)).toBeNull();
    expect(await signIn(auth, user.email, 'new-password-456')).toBeTruthy();

    // Single use.
    await expect(reset(auth, token, 'third-password-789')).rejects.toMatchObject({
      body: { code: 'INVALID_TOKEN' },
    });

    const actions = await auditActions(user.id);
    expect(actions).toEqual(
      expect.arrayContaining([
        { action: 'user.requestPasswordReset', meta: { delivery: 'mail' } },
        expect.objectContaining({ action: 'user.resetPassword' }),
      ]),
    );
  });

  it('answers the same for an unknown address and sends nothing', async () => {
    const { auth, resets, sent } = setup();
    const known = await createUser();
    const a = await auth.api.requestPasswordReset({ body: { email: known.email } });
    const b = await auth.api.requestPasswordReset({ body: { email: 'nobody@example.test' } });
    await resets.settle();
    expect(b).toEqual(a);
    expect(sent.map((mail) => mail.to[0])).toEqual([known.email]);
  });

  it('sends at most rateLimits.auth.mails per account', async () => {
    const { auth, resets, sent } = setup();
    const user = await createUser();
    for (let i = 0; i < 5; i++) {
      await auth.api.requestPasswordReset({ body: { email: user.email } });
    }
    await resets.settle();
    expect(sent).toHaveLength(3);
    const throttled = (await auditActions(user.id)).filter(
      (entry) => (entry.meta as { throttled?: boolean } | null)?.throttled,
    );
    expect(throttled).toHaveLength(2);
    await expect(resets.sendPasswordSetMail(user.id)).rejects.toMatchObject({
      key: 'auth.mails.tooMany',
    });
  });

  it('sends nothing to a banned account', async () => {
    const { auth, resets, sent } = setup();
    const user = await createUser();
    await repos.users.setBanned(user.id, true, null);
    await auth.api.requestPasswordReset({ body: { email: user.email } });
    await resets.settle();
    expect(sent).toEqual([]);
  });

  it('is off without a mail transport', async () => {
    const { auth, resets } = setup({ mail: false });
    const user = await createUser();
    expect(resets.mailEnabled).toBe(false);
    await expect(
      auth.api.requestPasswordReset({ body: { email: user.email } }),
    ).rejects.toMatchObject({ body: { code: 'RESET_PASSWORD_DISABLED' } });
    await expect(resets.sendPasswordSetMail(user.id)).rejects.toMatchObject({
      key: 'auth.mail.notConfigured',
    });
  });

  it('reports whether resets are offered', async () => {
    const status = async (mail: boolean) => {
      const { auth } = setup({ mail });
      const response = await auth.handler(
        new Request('http://api.test/api/auth/password-reset/status'),
      );
      return response.json();
    };
    expect(await status(true)).toEqual({ enabled: true });
    expect(await status(false)).toEqual({ enabled: false });
  });
});

describe('set-password links', () => {
  it('creates a one-time link without mail', async () => {
    const { auth, resets } = setup({ mail: false });
    const user = await createUser();
    const link = await resets.createPasswordSetLink(user.id, { expiresIn: 600 });
    expect(link.expiresAt.getTime()).toBeGreaterThan(Date.now() + 590_000);

    const token = tokenOf(link.url);
    await reset(auth, token);
    expect(await signIn(auth, user.email, 'new-password-456')).toBeTruthy();
    await expect(reset(auth, token)).rejects.toMatchObject({ body: { code: 'INVALID_TOKEN' } });
    expect(await auditActions(user.id)).toEqual(
      expect.arrayContaining([
        { action: 'user.requestPasswordReset', meta: { delivery: 'link' } },
        expect.objectContaining({ action: 'user.resetPassword' }),
      ]),
    );
  });

  it('refuses an expired link', async () => {
    const { auth, resets } = setup();
    const user = await createUser();
    const link = await resets.createPasswordSetLink(user.id, { expiresIn: 60 });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 120_000);
    await expect(reset(auth, tokenOf(link.url))).rejects.toMatchObject({
      body: { code: 'INVALID_TOKEN' },
    });
    vi.useRealTimers();
    expect(await signIn(auth, user.email, PASSWORD)).toBeTruthy();
  });

  it('mails a set-password link', async () => {
    const { auth, resets, sent } = setup();
    const user = await createUser();
    const { expiresAt } = await resets.sendPasswordSetMail(user.id);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 71 * 3600_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe('Set your Manablox password');
    await reset(auth, tokenOf(linkIn(sent[0] as Sent)));
    expect(await signIn(auth, user.email, 'new-password-456')).toBeTruthy();
  });

  it('refuses an unknown account', async () => {
    const { resets } = setup();
    await expect(
      resets.createPasswordSetLink('00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ key: 'user.notFound' });
  });
});
