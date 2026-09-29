import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MailTransport, ManabloxConfig } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrap, type Runtime } from '../src/bootstrap.js';

const ADMIN = 'http://admin.test';
const PASSWORD = 'old-password-123';

let db: TestDatabase;
let dir: string;
let withMail: Runtime;
let withoutMail: Runtime;
let app: Hono;
let appWithoutMail: Hono;
const sent: Array<{ to: string[]; text: string }> = [];

const transport: MailTransport = {
  name: 'test',
  send: async (message) => {
    sent.push({ to: message.to, text: message.text });
    return { id: null };
  },
};

const config = (mail: boolean): ManabloxConfig => ({
  database: { url: db.url },
  auth: { secret: 'password-reset-secret', trustedOrigins: [ADMIN] },
  fieldTypes: builtinFieldTypes,
  logLevel: 'silent' as const,
  server: { adminUrl: ADMIN, rateLimit: false },
  storage: { driver: 'local' as const, local: { path: join(dir, 'files') } },
  mail: mail ? { transport } : {},
});

let ipSeq = 0;
const call = (target: Hono, path: string, body?: unknown) =>
  target.request(`/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ADMIN,
      'x-forwarded-for': `198.51.100.${++ipSeq}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  db = await createTestDatabase('server_password_reset');
  dir = await mkdtemp(join(tmpdir(), 'manablox-password-reset-'));
  withMail = await bootstrap(config(true));
  withoutMail = await bootstrap(config(false));
  app = await createApp(withMail);
  appWithoutMail = await createApp(withoutMail);
});

afterAll(async () => {
  await withMail?.shutdown();
  await withoutMail?.shutdown();
  await db?.drop();
  await rm(dir, { recursive: true, force: true });
});

let seq = 0;
const createUser = () =>
  withMail.users.create({
    name: `Reset ${++seq}`,
    email: `server-reset-${seq}@example.test`,
    password: PASSWORD,
    role: 'editor',
  });

describe('password reset endpoints', () => {
  it('reports whether mail resets are offered', async () => {
    expect(await (await call(app, 'password-reset/status')).json()).toEqual({ enabled: true });
    expect(await (await call(appWithoutMail, 'password-reset/status')).json()).toEqual({
      enabled: false,
    });
  });

  it('mails a link to the admin reset page, redeemable once', async () => {
    const user = await createUser();
    sent.length = 0;
    const requested = await call(app, 'request-password-reset', { email: user.email });
    expect(requested.status).toBe(200);
    await withMail.passwordResets.settle();

    expect(sent).toHaveLength(1);
    const link = sent[0]?.text.split('\n').find((line) => line.startsWith(ADMIN)) ?? '';
    const token = new URL(link).searchParams.get('token');
    expect(link.startsWith(`${ADMIN}/reset-password?token=`)).toBe(true);

    const first = await call(app, 'reset-password', { token, newPassword: 'new-password-456' });
    expect(first.status).toBe(200);
    const again = await call(app, 'reset-password', { token, newPassword: 'new-password-789' });
    expect(again.status).toBe(400);

    const signIn = await call(app, 'sign-in/email', {
      email: user.email,
      password: 'new-password-456',
    });
    expect(signIn.status).toBe(200);
  });

  it('does not reveal whether an account exists', async () => {
    const user = await createUser();
    const known = await call(app, 'request-password-reset', { email: user.email });
    const unknown = await call(app, 'request-password-reset', { email: 'ghost@example.test' });
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it('refuses requests without mail, the same for every address', async () => {
    const user = await createUser();
    const known = await call(appWithoutMail, 'request-password-reset', { email: user.email });
    const unknown = await call(appWithoutMail, 'request-password-reset', {
      email: 'ghost@example.test',
    });
    expect(known.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it('redeems a set-password link from the runtime', async () => {
    const user = await createUser();
    const { url } = await withoutMail.passwordResets.createPasswordSetLink(user.id, {
      expiresIn: 600,
    });
    const token = new URL(url).searchParams.get('token');
    const response = await call(appWithoutMail, 'reset-password', {
      token,
      newPassword: 'set-password-456',
    });
    expect(response.status).toBe(200);
  });
});
