import { randomUUID } from 'node:crypto';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DnsResolver, VERIFICATION_WINDOW_MS } from '../src/host-verification.js';
import { createServiceContext, type ServiceContext, withControls } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
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
  ctx = await createServiceContext('host_verification', {
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
  const view = async (spaceId: string, id: string) =>
    (await ctx.apiHosts.list(spaceId)).find((row) => row.id === id);

  it('verifies at once while the control is off, as before', async () => {
    const space = await freshSpace();
    const added = await ctx.apiHosts.create(space.id, host());
    expect(added.verifiedAt).toBeInstanceOf(Date);
    expect(added.verification).toMatchObject({ status: 'verified', required: false });
    expect(await ctx.apiHosts.resolve(added.hostname)).toMatchObject({ spaceId: space.id });
  });

  it('keeps a new host pending and unserved until its TXT record matches', async () => {
    await requireVerification();
    const space = await freshSpace();
    const hostname = host();
    const added = await ctx.apiHosts.create(space.id, hostname);
    expect(added.verifiedAt).toBeNull();
    expect(added.verification).toMatchObject({
      status: 'pending',
      required: true,
      txtName: `_manablox.${hostname}`,
      cnameTarget: 'edge.example.net',
    });
    const token = added.verification.txtValue as string;
    expect(token).toMatch(/^manablox-verify-[0-9a-f]{32}$/);
    expect(await ctx.apiHosts.resolve(hostname)).toBeNull();

    // A wrong value does not count.
    dns.txt.set(`_manablox.${hostname}`, [['something-else']]);
    const missed = await ctx.apiHosts.verify(space.id, added.id);
    expect(missed.verification.status).toBe('pending');
    expect(missed.verificationCheckedAt).toBeInstanceOf(Date);

    // Long values arrive in chunks.
    const mark = await ctx.repos.controlEvents.latestSeq();
    dns.txt.set(`_manablox.${hostname}`, [['v=other'], [token.slice(0, 20), token.slice(20)]]);
    const verified = await ctx.apiHosts.verify(space.id, added.id);
    expect(verified.verification).toMatchObject({ status: 'verified', txtValue: null });
    expect(await ctx.apiHosts.resolve(hostname)).toMatchObject({ spaceId: space.id });
    expect(await eventsSince(mark)).toEqual([
      [
        'domain.verified',
        {
          spaceId: space.id,
          environmentId: added.environmentId,
          environment: 'production',
          domainId: added.id,
          hostname,
          kind: 'api',
        },
      ],
    ]);
  });

  it('accepts a CNAME to the configured target', async () => {
    await requireVerification();
    const space = await freshSpace();
    const hostname = host();
    const added = await ctx.apiHosts.create(space.id, hostname);
    dns.cname.set(hostname, ['elsewhere.example.net']);
    expect((await ctx.apiHosts.verify(space.id, added.id)).verification.status).toBe('pending');
    dns.cname.set(hostname, ['edge.example.net.']);
    expect((await ctx.apiHosts.verify(space.id, added.id)).verification.status).toBe('verified');
  });

  it('serves unverified hosts again once the control is off', async () => {
    await requireVerification();
    const space = await freshSpace();
    const added = await ctx.apiHosts.create(space.id, host());
    expect(await ctx.apiHosts.resolve(added.hostname)).toBeNull();
    await restoreControls?.();
    restoreControls = null;
    expect(await ctx.apiHosts.resolve(added.hostname)).toMatchObject({ spaceId: space.id });
    expect((await view(space.id, added.id))?.verification).toMatchObject({
      status: 'pending',
      required: false,
    });
  });

  it('checks pending hosts in a sweep and fails them after the window', async () => {
    await requireVerification();
    const space = await freshSpace();
    const soon = await ctx.apiHosts.create(space.id, host());
    const late = await ctx.apiHosts.create(space.id, host());
    await ctx.repos.spaceApiHosts.setVerification(late.id, {
      verificationStartedAt: new Date(Date.now() - VERIFICATION_WINDOW_MS - 60_000),
    });
    dns.txt.set(`_manablox.${soon.hostname}`, [[soon.verification.txtValue as string]]);

    const report = await ctx.hostVerifier.sweep();
    expect(report.verified).toBeGreaterThanOrEqual(1);
    expect(report.failed).toBeGreaterThanOrEqual(1);
    expect((await view(space.id, soon.id))?.verification.status).toBe('verified');
    expect((await view(space.id, late.id))?.verification.status).toBe('failed');

    // A failed host is left to "Verify now", which still verifies it.
    dns.txt.set(`_manablox.${late.hostname}`, [[late.verification.txtValue as string]]);
    await ctx.hostVerifier.sweep();
    expect((await view(space.id, late.id))?.verification.status).toBe('failed');
    const now = await ctx.apiHosts.verify(space.id, late.id);
    expect(now.verification).toMatchObject({ status: 'verified', failedAt: null });
  });
});

describe('API hosts', () => {
  it('adds, lists, resolves and removes hosts with events', async () => {
    const space = await freshSpace();
    const mark = await ctx.repos.controlEvents.latestSeq();
    const hostname = host();
    const added = await ctx.apiHosts.create(space.id, `https://${hostname.toUpperCase()}/x`);
    expect(added).toMatchObject({ hostname, spaceId: space.id });
    expect(added.verification.status).toBe('verified');
    expect((await ctx.apiHosts.list(space.id)).map((row) => row.hostname)).toEqual([hostname]);
    expect((await ctx.apiHosts.resolve(`${hostname}:443`))?.spaceId).toBe(space.id);
    expect(await ctx.apiHosts.any()).toBe(true);

    await ctx.apiHosts.delete(space.id, added.id);
    expect(await ctx.apiHosts.resolve(hostname)).toBeNull();
    const payload = {
      spaceId: space.id,
      environmentId: added.environmentId,
      environment: 'production',
      domainId: added.id,
      hostname,
      kind: 'api',
    };
    expect(await eventsSince(mark)).toEqual([
      ['domain.added', payload],
      ['domain.removed', payload],
    ]);
    const audit = await ctx.repos.audit.page({ spaceId: space.id, targetKind: 'apiHost' });
    expect(audit.items.map((entry) => entry.action).sort()).toEqual([
      'apiHost.create',
      'apiHost.delete',
    ]);
  });

  it('refuses invalid names and names another host uses', async () => {
    const space = await freshSpace();
    const other = await freshSpace();
    const taken = host();
    await ctx.apiHosts.create(other.id, taken);

    for (const [input, key] of [
      ['not a host', 'apiHost.hostname.invalid'],
      [taken, 'apiHost.hostname.taken'],
    ] as const) {
      await expect(ctx.apiHosts.create(space.id, input)).rejects.toMatchObject({
        key: 'apiHost.validation.failed',
        details: [expect.objectContaining({ key, path: ['hostname'] })],
      });
    }
  });

  it('replaces the hosts of a space and keeps the verification of kept ones', async () => {
    await requireVerification();
    const space = await freshSpace();
    const [a, b, c] = [host(), host(), host()];
    await ctx.apiHosts.replace(space.id, [a, b]);
    const first = await ctx.apiHosts.list(space.id);
    const kept = first.find((row) => row.hostname === b);
    dns.txt.set(`_manablox.${b}`, [[kept?.verification.txtValue as string]]);
    await ctx.apiHosts.verify(space.id, kept?.id as string);

    const after = await ctx.apiHosts.replace(space.id, [b, c]);
    expect(after.map((row) => [row.hostname, row.verification.status])).toEqual(
      [
        [b, 'verified'],
        [c, 'pending'],
      ].sort(([x], [y]) => String(x).localeCompare(String(y))),
    );
    expect(await ctx.apiHosts.resolve(a)).toBeNull();
    expect((await ctx.apiHosts.resolve(b))?.spaceId).toBe(space.id);
    // Pending hosts are not served while verification is required.
    expect(await ctx.apiHosts.resolve(c)).toBeNull();
  });

  it('counts toward customDomains and needs the feature', async () => {
    const space = await freshSpace();
    const scope = { kind: 'space' as const, id: space.id };
    const restore = await withControls(ctx, {
      scope,
      values: { 'limits.customDomains': { max: 1, mode: 'hard' } },
    });
    try {
      await ctx.apiHosts.create(space.id, host());
      await expect(ctx.apiHosts.create(space.id, host())).rejects.toMatchObject({
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

  it('moves with a replace restore target and goes with a deleted space', async () => {
    const space = await freshSpace();
    const other = await freshSpace();
    const hostname = host();
    await ctx.apiHosts.create(space.id, hostname);
    expect(await ctx.repos.spaceApiHosts.moveSpace(space.id, other.id)).toBe(1);
    expect((await ctx.apiHosts.resolve(hostname))?.spaceId).toBe(other.id);
    await ctx.spaces.delete(other.id);
    expect(await ctx.repos.spaceApiHosts.findByHostname(hostname)).toBeNull();
  });
});
