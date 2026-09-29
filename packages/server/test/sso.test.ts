import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MailTransport } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrap, type ManagementRuntime, requireManagement } from '../src/bootstrap.js';
import { type FakeOidcProvider, startFakeOidc } from './helpers/fake-oidc.js';
import { type SamlFixture, samlFixture } from './helpers/fake-saml.js';

const KEY = 'sso-control-key-0123456789';
const ADMIN = 'http://admin.sso.test';
const PASSWORD = 'sso-password-123';
const SECRET = 'sso-test-secret-0123456789abcdef';

let db: TestDatabase;
let dir: string;
let idp: FakeOidcProvider;
let saml: SamlFixture;
let runtime: ManagementRuntime;
let app: Hono;
let spaceId: string;
let admin: Jar;
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
async function account(email?: string) {
  seq += 1;
  return runtime.users.create({
    name: `Person ${seq}`,
    email: email ?? `person-${seq}@elsewhere.test`,
    password: PASSWORD,
    role: 'editor',
  });
}

async function signedIn(email: string): Promise<Jar> {
  const jar = new Jar();
  const response = await auth(jar, 'sign-in/email', { email, password: PASSWORD });
  expect(response.status).toBe(200);
  return jar;
}

/** Saves an OIDC provider for `domains` through the admin API. */
async function oidcProvider(
  providerId: string,
  domains: string[],
  extra: Record<string, unknown> = {},
) {
  const response = await rest(admin, 'sso/create', {
    providerId,
    name: `${providerId} login`,
    domains,
    oidc: { issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret },
    ...extra,
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return json(response);
}

/**
 * Starts an SSO sign-in in a fresh browser and comes back from the IdP as `user`; returns the
 * browser and where the callback sent it.
 */
async function ssoSignIn(providerId: string, user: { sub: string; email: string; name?: string }) {
  const jar = new Jar();
  const started = await auth(jar, 'sign-in/sso', {
    providerId,
    callbackURL: `${ADMIN}/`,
    errorCallbackURL: `${ADMIN}/login`,
  });
  expect(started.status, JSON.stringify(await started.clone().json())).toBe(200);
  const authorize = new URL((await json(started)).url);
  const redirect = new URL(authorize.searchParams.get('redirect_uri') ?? '');
  const back = new URL(redirect.pathname, 'http://api.test');
  back.searchParams.set('code', idp.codeFor(user));
  back.searchParams.set('state', authorize.searchParams.get('state') ?? '');
  const response = jar.keep(
    await app.request(`${back.pathname}${back.search}`, { headers: headers(jar) }),
  );
  return { jar, response, location: new URL(response.headers.get('location') ?? '', ADMIN) };
}

async function actions(userId: string) {
  const page = await runtime.repos.audit.pageByTarget({ kind: 'user', id: userId });
  return page.items.map((entry) => entry.action);
}

beforeAll(async () => {
  db = await createTestDatabase('server_sso');
  dir = await mkdtemp(join(tmpdir(), 'manablox-sso-'));
  idp = await startFakeOidc();
  saml = await samlFixture();
  runtime = requireManagement(
    await bootstrap({
      database: { url: db.url },
      // The fake IdP runs on a private address, so it is trusted explicitly.
      auth: { secret: SECRET, trustedOrigins: [ADMIN, idp.issuer] },
      fieldTypes: builtinFieldTypes,
      logLevel: 'silent',
      storage: { driver: 'local', local: { path: join(dir, 'files') } },
      server: { adminUrl: ADMIN, rateLimit: false, scopes: ['rpc', 'auth', 'control'] },
      control: { apiKey: KEY },
      mail: { transport },
    }),
  );
  app = await createApp(runtime);
  spaceId = (
    await runtime.repos.spaces.create({
      name: 'Main',
      machineName: 'main',
      url: 'https://main.test',
      defaultLocale: 'en',
      locales: ['en'],
    })
  ).id;
  const root = await runtime.users.create({
    name: 'Root',
    email: 'root@elsewhere.test',
    password: PASSWORD,
    role: 'superadmin',
  });
  await runtime.spaces.grant(spaceId, root.id, 'owner');
  admin = await signedIn(root.email);
}, 60_000);

afterEach(async () => {
  for (const key of ['features.sso', 'limits.seats']) await clearControl(key);
  await runtime.twoFactor.setPolicy('off');
  for (const row of await runtime.repos.ssoProviders.list()) await runtime.sso.delete(row.id);
  await runtime.passwordResets.settle();
  sent.length = 0;
});

afterAll(async () => {
  await runtime?.shutdown();
  await idp?.close();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('managing providers', () => {
  it('saves an OIDC provider from discovery, with the client secret encrypted', async () => {
    const created = await oidcProvider('acme', ['Acme.test', 'acme.test', '@corp.acme.test']);
    expect(created).toMatchObject({
      providerId: 'acme',
      protocol: 'oidc',
      domains: ['acme.test', 'corp.acme.test'],
      oidc: {
        issuer: idp.issuer,
        clientId: idp.clientId,
        clientSecretHint: idp.clientSecret.slice(-4),
        scopes: ['openid', 'email', 'profile'],
      },
      urls: { callback: 'http://localhost:3000/api/auth/sso/callback/acme', acs: null },
    });
    expect(JSON.stringify(created)).not.toContain(idp.clientSecret);

    const row = await runtime.repos.ssoProviders.findByProviderId('acme');
    expect(row?.oidcConfig).not.toContain(idp.clientSecret);
    expect(JSON.parse(row?.oidcConfig ?? '{}')).toMatchObject({
      clientSecret: expect.stringMatching(/^v2\./),
      tokenEndpoint: `${idp.issuer}/token`,
      jwksEndpoint: `${idp.issuer}/jwks`,
    });

    // An empty secret keeps the stored one.
    const updated = await rest(admin, 'sso/update', {
      id: created.id,
      name: 'Acme',
      domains: ['acme.test'],
      oidc: { issuer: idp.issuer, clientId: idp.clientId, clientSecret: '' },
      requireSso: true,
    });
    expect(updated.status).toBe(200);
    expect(await json(updated)).toMatchObject({
      name: 'Acme',
      requireSso: true,
      oidc: { clientSecretHint: idp.clientSecret.slice(-4) },
    });
    const audit = await runtime.repos.audit.pageByTarget({ kind: 'ssoProvider', id: created.id });
    expect(audit.items.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['ssoProvider.create', 'ssoProvider.update']),
    );
    expect(JSON.stringify(audit.items)).not.toContain(idp.clientSecret);
  });

  it('refuses taken ids and domains, bad issuers, and non-superadmins', async () => {
    await oidcProvider('acme', ['acme.test']);
    const again = await rest(admin, 'sso/create', {
      providerId: 'acme',
      name: 'Again',
      domains: ['other.test'],
      oidc: { issuer: idp.issuer, clientId: 'x', clientSecret: 'y' },
    });
    expect((await json(again)).error.details[0].key).toBe('sso.providerId.taken');
    const sameDomain = await rest(admin, 'sso/create', {
      providerId: 'acme-two',
      name: 'Two',
      domains: ['acme.test'],
      oidc: { issuer: idp.issuer, clientId: 'x', clientSecret: 'y' },
    });
    expect((await json(sameDomain)).error.details[0].key).toBe('sso.domain.taken');
    const unreachable = await rest(admin, 'sso/create', {
      providerId: 'nowhere',
      name: 'Nowhere',
      domains: ['nowhere.test'],
      oidc: { issuer: 'http://10.255.255.1', clientId: 'x', clientSecret: 'y' },
    });
    expect((await json(unreachable)).error.details[0].key).toBe('sso.discovery.failed');

    const editor = await account();
    const refused = await rest(await signedIn(editor.email), 'sso/list');
    expect(refused.status).toBe(403);
  });

  it('tests discovery before saving', async () => {
    const found = await json(await rest(admin, 'sso/test', { oidc: { issuer: idp.issuer } }));
    expect(found).toMatchObject({ ok: true, tokenEndpoint: `${idp.issuer}/token` });
    const missing = await json(
      await rest(admin, 'sso/test', { oidc: { issuer: `${idp.issuer}/nothing` } }),
    );
    expect(missing.ok).toBe(false);
  });
});

describe('OIDC sign-in', () => {
  it('creates an account just in time, with the default grants, counted and audited', async () => {
    await oidcProvider('acme', ['acme.test'], { defaultGrants: [{ spaceId, role: 'editor' }] });
    const since = await runtime.repos.controlEvents.latestSeq();
    const { jar, response, location } = await ssoSignIn('acme', {
      sub: 'idp-ada',
      email: 'Ada@Acme.test',
      name: 'Ada',
    });
    expect(response.status).toBe(302);
    expect(location.href).toBe(`${ADMIN}/`);

    const me = await json(await rest(jar, 'users/me'));
    expect(me).toMatchObject({ email: 'ada@acme.test', name: 'Ada' });
    const user = await runtime.repos.users.findByEmail('ada@acme.test');
    expect(user).toMatchObject({ emailVerified: true, role: 'editor' });
    expect(await runtime.repos.users.findSpaceRole(user?.id ?? '', spaceId)).toBe('editor');
    expect(await actions(user?.id ?? '')).toEqual(expect.arrayContaining(['user.create']));
    const events = await runtime.repos.controlEvents.listAfter(since, 100);
    expect(events.map((event) => event.type)).toContain('user.created');
    // The secret reached the IdP decrypted.
    expect(idp.presentedSecrets.at(-1)).toBe(idp.clientSecret);

    // A second sign-in finds the same account.
    const again = await ssoSignIn('acme', { sub: 'idp-ada', email: 'ada@acme.test' });
    expect(again.location.href).toBe(`${ADMIN}/`);
    expect((await json(await rest(again.jar, 'users/me'))).id).toBe(user?.id);
  });

  it('refuses a new account over the seat limit, and addresses outside its domains', async () => {
    await oidcProvider('acme', ['acme.test']);
    await setControls({ 'limits.seats': { max: await runtime.repos.users.count() } });
    const full = await ssoSignIn('acme', { sub: 'idp-new', email: 'new@acme.test' });
    expect(full.location.pathname).toBe('/login');
    expect(full.location.searchParams.get('error')).toBe('sso_seats');
    expect(await runtime.repos.users.findByEmail('new@acme.test')).toBeNull();

    const outside = await ssoSignIn('acme', { sub: 'idp-x', email: 'someone@elsewhere.test' });
    expect(outside.location.searchParams.get('error')).toBe('sso_domain');
    expect((await rest(outside.jar, 'users/me')).status).toBe(401);
  });

  it('refuses unknown addresses when the provider creates no accounts, and audits it', async () => {
    await oidcProvider('acme', ['acme.test'], { createAccounts: false });
    const refused = await ssoSignIn('acme', { sub: 'idp-no', email: 'no@acme.test' });
    expect(refused.location.searchParams.get('error')).toBe('sso_no_account');
    // Written once the refused sign-in's transaction has ended.
    await vi.waitFor(async () => {
      const failures = await runtime.repos.audit.page({ actions: ['session.signInFailed'] });
      expect(failures.items.map((entry) => entry.meta)).toContainEqual({
        reason: 'sso.account',
        providerId: 'acme',
      });
    });
  });

  it('links an existing account with the same address; removing the provider unlinks it', async () => {
    await oidcProvider('acme', ['acme.test']);
    const existing = await account('grace@acme.test');
    const { jar } = await ssoSignIn('acme', { sub: 'idp-grace', email: 'grace@acme.test' });
    expect((await json(await rest(jar, 'users/me'))).id).toBe(existing.id);
    expect(await actions(existing.id)).toContain('user.linkSso');
    // The password still works.
    await signedIn('grace@acme.test');

    const row = await runtime.repos.ssoProviders.findByProviderId('acme');
    expect(await runtime.repos.ssoProviders.accountOwner('acme', 'idp-grace')).toBe(existing.id);
    expect((await rest(admin, 'sso/delete', { id: row?.id })).status).toBe(200);
    expect(await runtime.repos.ssoProviders.accountOwner('acme', 'idp-grace')).toBeNull();
    // Its session stays.
    expect((await rest(jar, 'users/me')).status).toBe(200);
  });

  it('is not asked for two-factor enrolment by the policy', async () => {
    await oidcProvider('acme', ['acme.test']);
    await runtime.twoFactor.setPolicy('all');
    const { jar } = await ssoSignIn('acme', { sub: 'idp-lin', email: 'lin@acme.test' });
    const me = await json(await rest(jar, 'users/me'));
    expect(me.twoFactor).toMatchObject({ pending: false });
    const { sessions } = runtime.handle.tables;
    const rows = await runtime.handle.db.select().from(sessions);
    expect(rows.filter((row) => row.userId === me.id).map((row) => row.ssoProviderId)).toEqual([
      'acme',
    ]);
    // A password sign-in is covered.
    const password = await account();
    const passwordJar = await signedIn(password.email);
    expect((await json(await rest(passwordJar, 'users/me'))).twoFactor).toMatchObject({
      pending: true,
    });
  });
});

describe('require SSO', () => {
  it('refuses password sign-in and resets for its domains; sessions stay', async () => {
    const person = await account('kim@acme.test');
    const earlier = await signedIn(person.email);
    await oidcProvider('acme', ['acme.test'], { requireSso: true });

    const password = await auth(new Jar(), 'sign-in/email', {
      email: 'kim@acme.test',
      password: PASSWORD,
    });
    expect(password.status).toBe(403);
    expect(await json(password)).toMatchObject({ code: 'SSO_REQUIRED' });
    const reset = await auth(new Jar(), 'request-password-reset', { email: 'Kim@acme.test' });
    expect(reset.status).toBe(403);
    const link = await runtime.passwordResets.createPasswordSetLink(person.id);
    const redeem = await auth(new Jar(), 'reset-password', {
      token: new URL(link.url).searchParams.get('token'),
      newPassword: 'another-password-123',
    });
    expect(redeem.status).toBe(403);
    expect((await rest(earlier, 'users/me')).status).toBe(200);

    // Other domains are not affected.
    await signedIn((await account()).email);

    const lookup = await json(await auth(new Jar(), 'sso/lookup', { email: 'kim@acme.test' }));
    expect(lookup.provider).toMatchObject({ providerId: 'acme', required: true });
  });

  it('stops applying while the feature is off, which also refuses SSO sign-in', async () => {
    await account('lee@acme.test');
    await oidcProvider('acme', ['acme.test'], { requireSso: true, showOnSignIn: true });
    const listed = await app.request('/api/auth/sso/sign-in-providers', {
      headers: { origin: ADMIN },
    });
    expect((await json(listed)).providers).toEqual([{ providerId: 'acme', name: 'acme login' }]);

    // Signed in at the IdP before the feature went off.
    const jar = new Jar();
    const started = await json(
      await auth(jar, 'sign-in/sso', { providerId: 'acme', callbackURL: `${ADMIN}/` }),
    );
    await setControls({ 'features.sso': { enabled: false } });

    await signedIn('lee@acme.test');
    const refused = await auth(new Jar(), 'sign-in/sso', {
      providerId: 'acme',
      callbackURL: `${ADMIN}/`,
    });
    expect(refused.status).toBe(403);
    expect(await json(refused)).toMatchObject({ code: 'FEATURE_OFF' });
    const authorize = new URL(started.url);
    const back = new URL(new URL(authorize.searchParams.get('redirect_uri') ?? '').pathname, ADMIN);
    back.searchParams.set('code', idp.codeFor({ sub: 'idp-lee', email: 'lee@acme.test' }));
    back.searchParams.set('state', authorize.searchParams.get('state') ?? '');
    const callback = await app.request(`${back.pathname}${back.search}`, { headers: headers(jar) });
    expect(new URL(callback.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'sso_disabled',
    );
    const hidden = await app.request('/api/auth/sso/sign-in-providers', {
      headers: { origin: ADMIN },
    });
    expect((await json(hidden)).providers).toEqual([]);

    // Stored providers stay; changing them waits for the feature.
    expect((await json(await rest(admin, 'sso/list'))).providers).toHaveLength(1);
    const locked = await rest(admin, 'sso/test', { oidc: { issuer: idp.issuer } });
    expect((await json(locked)).error.key).toBe('control.feature');
  });
});

const METADATA = '/api/auth/sso/saml2/sp/metadata?providerId=corp';
const ACS = '/api/auth/sso/saml2/sp/acs/corp';

/** Saves the SAML provider `corp` through the admin API. */
async function samlProvider(extra: Record<string, unknown> = {}) {
  const response = await rest(admin, 'sso/create', {
    providerId: 'corp',
    name: 'Corp',
    domains: ['corp.test'],
    saml: {
      entryPoint: saml.entryPoint,
      certificate: saml.certificate,
      idpEntityId: saml.idpEntityId,
      ...extra,
    },
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  return json(response);
}

const spMetadata = async () => (await app.request(METADATA)).text();

/** Starts a SAML sign-in in `jar`; returns the AuthnRequest URL. */
async function samlStart(jar: Jar): Promise<URL> {
  const started = await auth(jar, 'sign-in/sso', {
    providerId: 'corp',
    callbackURL: `${ADMIN}/`,
    errorCallbackURL: `${ADMIN}/login`,
  });
  expect(started.status).toBe(200);
  return new URL((await json(started)).url);
}

/** Posts a SAML response to the ACS as the browser in `jar`. */
async function samlPost(jar: Jar, body: Record<string, string>) {
  return jar.keep(
    await app.request(ACS, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(jar.header ? { cookie: jar.header } : {}),
        'x-forwarded-for': `203.0.113.${(++ipSeq % 250) + 1}`,
      },
      body: new URLSearchParams(body).toString(),
    }),
  );
}

describe('SAML', () => {
  it('saves a provider and serves the service provider metadata', async () => {
    const response = await rest(admin, 'sso/create', {
      providerId: 'corp',
      name: 'Corp',
      domains: ['corp.test'],
      saml: {
        entryPoint: saml.entryPoint,
        certificate: saml.certificate,
        idpEntityId: saml.idpEntityId,
      },
    });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const created = await json(response);
    expect(created).toMatchObject({
      protocol: 'saml',
      saml: { idpEntityId: saml.idpEntityId, certificateExpiresAt: expect.any(String) },
      urls: {
        acs: 'http://localhost:3000/api/auth/sso/saml2/sp/acs/corp',
        metadata: 'http://localhost:3000/api/auth/sso/saml2/sp/metadata?providerId=corp',
        spEntityId: 'http://localhost:3000/api/auth/sso/saml2/sp/metadata?providerId=corp',
      },
    });
    const metadata = await app.request('/api/auth/sso/saml2/sp/metadata?providerId=corp');
    const xml = await metadata.text();
    expect(xml).toContain(
      'entityID="http://localhost:3000/api/auth/sso/saml2/sp/metadata?providerId=corp"',
    );
    expect(xml).toContain('Location="http://localhost:3000/api/auth/sso/saml2/sp/acs/corp"');
    expect(xml).toContain('WantAssertionsSigned="true"');

    const broken = await rest(admin, 'sso/create', {
      providerId: 'broken',
      name: 'Broken',
      domains: ['broken.test'],
      saml: { entryPoint: saml.entryPoint, certificate: 'not a cert', idpEntityId: 'x' },
    });
    expect((await json(broken)).error.details[0].key).toBe('sso.certificate.invalid');
  });

  it('signs in with a signed assertion and creates the account', async () => {
    await rest(admin, 'sso/create', {
      providerId: 'corp',
      name: 'Corp',
      domains: ['corp.test'],
      saml: {
        entryPoint: saml.entryPoint,
        certificate: saml.certificate,
        idpEntityId: saml.idpEntityId,
      },
    });
    const jar = new Jar();
    const started = await auth(jar, 'sign-in/sso', {
      providerId: 'corp',
      callbackURL: `${ADMIN}/`,
      errorCallbackURL: `${ADMIN}/login`,
    });
    expect(started.status).toBe(200);
    const request = new URL((await json(started)).url);
    const metadata = await app.request('/api/auth/sso/saml2/sp/metadata?providerId=corp');
    const posted = await saml.respond({
      request,
      spMetadata: await metadata.text(),
      nameId: 'mo@corp.test',
    });
    const acs = jar.keep(
      await app.request('/api/auth/sso/saml2/sp/acs/corp', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: jar.header,
          'x-forwarded-for': '203.0.113.9',
        },
        body: new URLSearchParams(posted).toString(),
      }),
    );
    expect(acs.status, await acs.clone().text()).toBe(302);
    expect(acs.headers.get('location')).toBe(`${ADMIN}/`);
    const me = await json(await rest(jar, 'users/me'));
    expect(me).toMatchObject({ email: 'mo@corp.test' });
  });
});

describe('SAML service provider keys', () => {
  it('generates a key pair on save, keeps the private key encrypted, and publishes the certificate', async () => {
    const created = await samlProvider();
    expect(created.saml).toMatchObject({
      signRequests: false,
      encryptAssertions: false,
      idpInitiated: false,
      landingPath: '/',
      spCertificate: expect.stringContaining('-----BEGIN CERTIFICATE-----'),
      spCertificateExpiresAt: expect.any(String),
    });
    expect(JSON.stringify(created)).not.toContain('PRIVATE KEY');
    const row = await runtime.repos.ssoProviders.findByProviderId('corp');
    expect(row?.samlConfig).not.toContain('PRIVATE KEY');
    expect(JSON.parse(row?.samlConfig ?? '{}').spMetadata.privateKey).toMatch(/^v2\./);

    const xml = await spMetadata();
    const body = created.saml.spCertificate.replace(/-----[^-]+-----|\s+/g, '');
    expect(xml).toContain(`<md:KeyDescriptor use="signing">`);
    expect(xml).toContain(body);
    expect(xml).toContain('AuthnRequestsSigned="false"');
    expect(xml).not.toContain('use="encryption"');

    // Saving again keeps the key pair.
    const updated = await rest(admin, 'sso/update', {
      id: created.id,
      name: 'Corp',
      domains: ['corp.test'],
      saml: {
        entryPoint: saml.entryPoint,
        certificate: saml.certificate,
        idpEntityId: saml.idpEntityId,
        signRequests: true,
      },
    });
    expect((await json(updated)).saml).toMatchObject({
      signRequests: true,
      spCertificate: created.saml.spCertificate,
    });
  });

  it('signs AuthnRequests when asked, as the IdP verifies', async () => {
    const created = await samlProvider({ signRequests: true });
    expect(await spMetadata()).toContain('AuthnRequestsSigned="true"');
    const jar = new Jar();
    const request = await samlStart(jar);
    expect(request.searchParams.get('Signature')).toBeTruthy();
    const posted = await saml.respond({
      request,
      spMetadata: await spMetadata(),
      nameId: 'sig@corp.test',
      signedRequests: true,
    });
    const acs = await samlPost(jar, posted);
    expect(acs.status, await acs.clone().text()).toBe(302);
    expect(acs.headers.get('location')).toBe(`${ADMIN}/`);
    expect((await json(await rest(jar, 'users/me'))).email).toBe('sig@corp.test');

    // Unsigned requests fail at an IdP that wants them signed.
    await rest(admin, 'sso/update', {
      id: created.id,
      name: 'Corp',
      domains: ['corp.test'],
      saml: {
        entryPoint: saml.entryPoint,
        certificate: saml.certificate,
        idpEntityId: saml.idpEntityId,
      },
    });
    const unsigned = await samlStart(new Jar());
    expect(unsigned.searchParams.get('Signature')).toBeNull();
    await expect(
      saml.respond({
        request: unsigned,
        spMetadata: await spMetadata(),
        nameId: 'sig@corp.test',
        signedRequests: true,
      }),
    ).rejects.toThrow();
  });

  it('decrypts encrypted assertions and refuses plain ones when encryption is required', async () => {
    await samlProvider({ encryptAssertions: true });
    const xml = await spMetadata();
    expect(xml).toContain('<md:KeyDescriptor use="encryption">');

    const jar = new Jar();
    const request = await samlStart(jar);
    const posted = await saml.respond({
      request,
      spMetadata: xml,
      nameId: 'enc@corp.test',
      encrypt: true,
    });
    expect(Buffer.from(posted.SAMLResponse, 'base64').toString()).toContain('EncryptedAssertion');
    const acs = await samlPost(jar, posted);
    expect(acs.status, await acs.clone().text()).toBe(302);
    expect((await json(await rest(jar, 'users/me'))).email).toBe('enc@corp.test');

    const plainJar = new Jar();
    const plain = await saml.respond({
      request: await samlStart(plainJar),
      spMetadata: xml,
      nameId: 'plain@corp.test',
    });
    const refused = await samlPost(plainJar, plain);
    const location = new URL(refused.headers.get('location') ?? '');
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBe('saml_error');
    expect((await rest(plainJar, 'users/me')).status).toBe(401);
    expect(await runtime.repos.users.findByEmail('plain@corp.test')).toBeNull();
  });

  it('regenerates the key pair; the old certificate stops working at once', async () => {
    const created = await samlProvider({ signRequests: true });
    const before = await spMetadata();
    const regenerated = await rest(admin, 'sso/regenerateKeys', { id: created.id });
    expect(regenerated.status).toBe(200);
    const after = await json(regenerated);
    expect(after.saml.spCertificate).not.toBe(created.saml.spCertificate);
    expect(after.saml.signRequests).toBe(true);
    const xml = await spMetadata();
    expect(xml).not.toBe(before);
    expect(xml).toContain(after.saml.spCertificate.replace(/-----[^-]+-----|\s+/g, ''));

    // An IdP still holding the old certificate refuses the request.
    await expect(
      saml.respond({
        request: await samlStart(new Jar()),
        spMetadata: before,
        nameId: 'rot@corp.test',
        signedRequests: true,
      }),
    ).rejects.toThrow();
    const jar = new Jar();
    const posted = await saml.respond({
      request: await samlStart(jar),
      spMetadata: xml,
      nameId: 'rot@corp.test',
      signedRequests: true,
    });
    expect((await samlPost(jar, posted)).status).toBe(302);

    const audit = await runtime.repos.audit.pageByTarget({ kind: 'ssoProvider', id: created.id });
    expect(audit.items.map((entry) => entry.meta)).toContainEqual({ spKeysRegenerated: true });
    expect(JSON.stringify(audit.items)).not.toContain('PRIVATE KEY');
  });
});

describe('IdP-initiated SAML sign-in', () => {
  it('is refused unless the provider accepts it', async () => {
    await samlProvider();
    const posted = await saml.unsolicited({
      spMetadata: await spMetadata(),
      nameId: 'un@corp.test',
    });
    const refused = await samlPost(new Jar(), posted);
    expect(refused.status).toBe(302);
    const location = new URL(refused.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe(`${ADMIN}/login`);
    expect(location.searchParams.get('error')).toBe('unsolicited_response');
    expect(await runtime.repos.users.findByEmail('un@corp.test')).toBeNull();
  });

  it('signs in once at the landing path, refusing replays and other audiences', async () => {
    await samlProvider({ idpInitiated: true, landingPath: '/spaces' });
    const xml = await spMetadata();
    const posted = await saml.unsolicited({ spMetadata: xml, nameId: 'idp@corp.test' });
    const jar = new Jar();
    const accepted = await samlPost(jar, posted);
    expect(accepted.status, await accepted.clone().text()).toBe(302);
    expect(accepted.headers.get('location')).toBe(`${ADMIN}/spaces`);
    expect((await json(await rest(jar, 'users/me'))).email).toBe('idp@corp.test');

    const replay = await samlPost(new Jar(), posted);
    expect(new URL(replay.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'replay_detected',
    );

    const other = xml.replace(/entityID="[^"]+"/, 'entityID="https://other.sp.test"');
    const elsewhere = await saml.unsolicited({ spMetadata: other, nameId: 'idp@corp.test' });
    const wrongAudience = await samlPost(new Jar(), elsewhere);
    expect(new URL(wrongAudience.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'invalid_saml_response',
    );
  });

  it('accepts encrypted unsolicited assertions and refuses landing paths off the admin', async () => {
    await samlProvider({ idpInitiated: true, encryptAssertions: true });
    const posted = await saml.unsolicited({
      spMetadata: await spMetadata(),
      nameId: 'both@corp.test',
      encrypt: true,
    });
    const accepted = await samlPost(new Jar(), posted);
    expect(accepted.headers.get('location')).toBe(`${ADMIN}/`);

    for (const landingPath of ['https://evil.test/', '//evil.test/x', 'spaces', '/a b']) {
      const response = await rest(admin, 'sso/create', {
        providerId: 'landing',
        name: 'Landing',
        domains: ['landing.test'],
        saml: {
          entryPoint: saml.entryPoint,
          certificate: saml.certificate,
          idpEntityId: saml.idpEntityId,
          idpInitiated: true,
          landingPath,
        },
      });
      expect((await json(response)).error.details[0].key, landingPath).toBe(
        'sso.landingPath.invalid',
      );
    }
  });
});
