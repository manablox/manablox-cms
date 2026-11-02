import { randomUUID } from 'node:crypto';
import { builtinFieldTypes } from '@manablox/fields';
import { type DnsResolver, VERIFICATION_WINDOW_MS } from '@manablox/services';
import { withControls } from '@manablox/services/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { websiteRepos } from '../../src/server/db/index.js';
import { createWebsiteContext, type WebsiteContext } from '../helpers/context.js';
import { TEST_TYPES } from '../helpers/types.js';

let ctx: WebsiteContext;
let counter = 0;
let restoreControls: (() => Promise<void>) | null = null;

/** TXT records by name and CNAMEs by host; everything else is not found. */
const dns = { txt: new Map<string, string[][]>(), cname: new Map<string, string[]>() };
const notFound = () => Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
const fakeResolver: DnsResolver = {
  resolveTxt: async (name) => {
    const records = dns.txt.get(name);
    if (!records) throw notFound();
    return records;
  },
  resolveCname: async (name) => {
    const records = dns.cname.get(name);
    if (!records) throw notFound();
    return records;
  },
};

beforeAll(async () => {
  ctx = await createWebsiteContext('site_host_verification', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
    config: { control: { domainCnameTarget: 'Edge.Example.NET.' } },
  });
  ctx.hostVerifier.resolver = fakeResolver;
});
afterAll(async () => {
  await ctx?.close();
});
beforeEach(async () => {
  dns.txt.clear();
  dns.cname.clear();
  await restoreControls?.();
  restoreControls = null;
});

const host = () => `h${++counter}-${randomUUID().slice(0, 6)}.example.test`;

const freshSpace = async () => {
  const machineName = `hv-${++counter}-${randomUUID().slice(0, 6)}`;
  return ctx.spaces.create({ name: machineName, machineName, url: 'http://hv.test' }, null);
};

const requireVerification = async () => {
  restoreControls = await withControls(ctx, { values: { 'domains.requireVerification': true } });
};

const eventsSince = async (mark: number) =>
  (await ctx.repos.controlEvents.listAfter(mark, 1000)).map((event) => [event.type, event.payload]);

describe('custom domain verification', () => {
  it('verifies at once while the control is off, as before', async () => {
    const space = await freshSpace();
    const domain = await ctx.website.domains.create(space.id, { hostname: host() });
    expect(domain.verifiedAt).toBeInstanceOf(Date);
    expect(domain.verification).toMatchObject({ status: 'verified', required: false });
    expect(await ctx.website.domains.resolveHost(domain.hostname)).toMatchObject({
      spaceId: space.id,
    });
  });

  it('keeps a new domain pending and unserved until its TXT record matches', async () => {
    await requireVerification();
    const space = await freshSpace();
    const hostname = host();
    const domain = await ctx.website.domains.create(space.id, { hostname });
    expect(domain.verifiedAt).toBeNull();
    expect(domain.verification).toMatchObject({
      status: 'pending',
      required: true,
      txtName: `_manablox.${hostname}`,
      cnameTarget: 'edge.example.net',
    });
    const token = domain.verification.txtValue as string;
    expect(token).toMatch(/^manablox-verify-[0-9a-f]{32}$/);
    expect(await ctx.website.domains.resolveHost(hostname)).toBeNull();

    // A wrong value does not count.
    dns.txt.set(`_manablox.${hostname}`, [['something-else']]);
    const missed = await ctx.website.domains.verify(space.id, domain.id);
    expect(missed.verification.status).toBe('pending');
    expect(missed.verificationCheckedAt).toBeInstanceOf(Date);

    // Long values arrive in chunks.
    const mark = await ctx.repos.controlEvents.latestSeq();
    dns.txt.set(`_manablox.${hostname}`, [['v=other'], [token.slice(0, 20), token.slice(20)]]);
    const verified = await ctx.website.domains.verify(space.id, domain.id);
    expect(verified.verification).toMatchObject({ status: 'verified', txtValue: null });
    expect(await ctx.website.domains.resolveHost(hostname)).toMatchObject({ spaceId: space.id });
    expect(await eventsSince(mark)).toEqual([
      [
        'domain.verified',
        {
          spaceId: space.id,
          environmentId: domain.environmentId,
          environment: 'production',
          domainId: domain.id,
          hostname,
          kind: 'site',
          locale: null,
        },
      ],
    ]);
  });

  it('accepts a CNAME to the configured target', async () => {
    await requireVerification();
    const space = await freshSpace();
    const hostname = host();
    const domain = await ctx.website.domains.create(space.id, { hostname });
    dns.cname.set(hostname, ['elsewhere.example.net']);
    expect((await ctx.website.domains.verify(space.id, domain.id)).verification.status).toBe(
      'pending',
    );
    dns.cname.set(hostname, ['edge.example.net.']);
    expect((await ctx.website.domains.verify(space.id, domain.id)).verification.status).toBe(
      'verified',
    );
  });

  it('serves unverified domains again once the control is off', async () => {
    await requireVerification();
    const space = await freshSpace();
    const domain = await ctx.website.domains.create(space.id, { hostname: host() });
    expect(await ctx.website.domains.resolveHost(domain.hostname)).toBeNull();
    await restoreControls?.();
    restoreControls = null;
    expect(await ctx.website.domains.resolveHost(domain.hostname)).toMatchObject({
      spaceId: space.id,
    });
    expect((await ctx.website.domains.get(space.id, domain.id)).verification).toMatchObject({
      status: 'pending',
      required: false,
    });
  });

  it('asks for a new proof when the host name changes', async () => {
    await requireVerification();
    const space = await freshSpace();
    const domain = await ctx.website.domains.create(space.id, { hostname: host() });
    dns.txt.set(`_manablox.${domain.hostname}`, [[domain.verification.txtValue as string]]);
    await ctx.website.domains.verify(space.id, domain.id);
    const renamed = await ctx.website.domains.update(space.id, domain.id, { hostname: host() });
    expect(renamed.verification.status).toBe('pending');
    expect(renamed.verification.txtValue).not.toBe(domain.verification.txtValue);
    // Other edits keep it.
    dns.txt.set(`_manablox.${renamed.hostname}`, [[renamed.verification.txtValue as string]]);
    await ctx.website.domains.verify(space.id, domain.id);
    const edited = await ctx.website.domains.update(space.id, domain.id, {
      redirectToPrimary: true,
    });
    expect(edited.verification.status).toBe('verified');
  });

  it('checks pending hosts in a sweep and fails them after the window', async () => {
    await requireVerification();
    const space = await freshSpace();
    const soon = await ctx.website.domains.create(space.id, { hostname: host() });
    const late = await ctx.website.domains.create(space.id, { hostname: host() });
    const api = await ctx.apiHosts.create(space.id, host());
    await websiteRepos(ctx.repos).domains.setVerification(late.id, {
      verificationStartedAt: new Date(Date.now() - VERIFICATION_WINDOW_MS - 60_000),
    });
    dns.txt.set(`_manablox.${soon.hostname}`, [[soon.verification.txtValue as string]]);
    dns.txt.set(`_manablox.${api.hostname}`, [[api.verification.txtValue as string]]);

    const report = await ctx.hostVerifier.sweep();
    expect(report.verified).toBeGreaterThanOrEqual(2);
    expect(report.failed).toBeGreaterThanOrEqual(1);
    expect((await ctx.website.domains.get(space.id, soon.id)).verification.status).toBe('verified');
    expect((await ctx.website.domains.get(space.id, late.id)).verification.status).toBe('failed');
    expect((await ctx.apiHosts.list(space.id))[0]?.verification.status).toBe('verified');

    // A failed host is left to "Verify now", which still verifies it.
    dns.txt.set(`_manablox.${late.hostname}`, [[late.verification.txtValue as string]]);
    await ctx.hostVerifier.sweep();
    expect((await ctx.website.domains.get(space.id, late.id)).verification.status).toBe('failed');
    const now = await ctx.website.domains.verify(space.id, late.id);
    expect(now.verification).toMatchObject({ status: 'verified', failedAt: null });
  });
});

describe('site domains beside API hosts', () => {
  it('refuses invalid names and names another host or site domain uses', async () => {
    const space = await freshSpace();
    const other = await freshSpace();
    const taken = host();
    await ctx.apiHosts.create(other.id, taken);
    const domain = host();
    await ctx.website.domains.create(other.id, { hostname: domain });

    for (const [input, key] of [
      ['not a host', 'apiHost.hostname.invalid'],
      [taken, 'apiHost.hostname.taken'],
      [domain, 'apiHost.hostname.taken'],
    ] as const) {
      await expect(ctx.apiHosts.create(space.id, input)).rejects.toMatchObject({
        key: 'apiHost.validation.failed',
        details: [expect.objectContaining({ key, path: ['hostname'] })],
      });
    }
    // A site domain cannot take an API host's name either.
    await expect(ctx.website.domains.create(space.id, { hostname: taken })).rejects.toMatchObject({
      details: [expect.objectContaining({ key: 'plugins.website.domain.hostname.taken' })],
    });
  });

  it('counts toward customDomains and needs the feature', async () => {
    const space = await freshSpace();
    const scope = { kind: 'space' as const, id: space.id };
    const restore = await withControls(ctx, {
      scope,
      values: { 'limits.customDomains': { max: 2, mode: 'hard' } },
    });
    try {
      await ctx.website.domains.create(space.id, { hostname: host() });
      await ctx.apiHosts.create(space.id, host());
      await expect(ctx.apiHosts.create(space.id, host())).rejects.toMatchObject({
        key: 'control.limit',
      });
      await expect(
        ctx.website.domains.create(space.id, { hostname: host() }),
      ).rejects.toMatchObject({
        key: 'control.limit',
      });
    } finally {
      await restore();
    }
    const off = await withControls(ctx, { scope, features: { customDomains: false } });
    try {
      await expect(ctx.apiHosts.create(space.id, host())).rejects.toMatchObject({
        key: 'control.feature',
      });
    } finally {
      await off();
    }
  });
});
