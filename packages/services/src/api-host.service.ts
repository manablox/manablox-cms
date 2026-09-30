import {
  API_HOSTS_CACHE_TAG,
  auditor,
  ManabloxError,
  purgeTags,
  type Scope,
  type SpaceScope,
  scopeSpaceId,
  snapshotChanges,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import {
  type Repositories,
  type SpaceApiHostRow,
  uniqueViolation,
  whenCommitted,
} from '@manablox/db';
import type { HostSource } from './data/provider.js';
import { type HostVerificationView, HostVerifier } from './host-verification.js';
import { normaliseHostname } from './lib/hostnames.js';
import { environmentPayload, requireInSpace } from './lib.js';

export type { SpaceApiHostRow };

/** An API host with what the admin shows to verify it. */
export type ApiHostView = SpaceApiHostRow & { verification: HostVerificationView };

const hostnameConflict = uniqueViolation({
  constraint: 'hostname',
  key: 'apiHost.hostname.taken',
  path: ['hostname'],
  errorKey: 'apiHost.validation.failed',
});

const invalid = (
  key: 'apiHost.hostname.invalid' | 'apiHost.hostname.taken',
  path: Array<string | number>,
  hostname: string,
) => ManabloxError.validation([{ key, path, params: { hostname } }], 'apiHost.validation.failed');

/** API hosts, core's host source. */
export const API_HOST_SOURCE: HostSource<SpaceApiHostRow> = {
  kind: 'api',
  cacheTag: API_HOSTS_CACHE_TAG,
  find: (repos, hostname) => repos.spaceApiHosts.findByHostname(hostname),
  pending: (repos, limit) => repos.spaceApiHosts.listPendingVerification(limit),
  setVerification: (repos, id, data) => repos.spaceApiHosts.setVerification(id, data),
  moveSpace: (repos, from, to) => repos.spaceApiHosts.moveSpace(from, to),
};

/**
 * Host names the public API answers a space on, when no space is pinned. They count toward
 * `customDomains`, need that feature and, with `domains.requireVerification`, a DNS check.
 */
export class ApiHostService {
  private readonly audit;
  readonly verifier: HostVerifier;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    verifier?: HostVerifier,
  ) {
    this.audit = auditor(repos, 'apiHost', (row: SpaceApiHostRow) => row.hostname);
    this.verifier = verifier ?? new HostVerifier(manablox, repos);
  }

  async list(scope: Scope): Promise<ApiHostView[]> {
    return this.views(await this.repos.spaceApiHosts.listBySpace(scope));
  }

  /** The space and environment a request's `Host` names; `null` for an unknown or unverified host. */
  async resolve(host: string): Promise<SpaceScope | null> {
    const hostname = host.length > 300 ? null : normaliseHostname(host);
    if (!hostname) return null;
    const row = await this.repos.spaceApiHosts.findByHostname(hostname);
    if (!row || (await this.verifier.blocks(row))) return null;
    return { spaceId: row.spaceId, environmentId: row.environmentId };
  }

  /** Whether the instance has any API host. */
  any(): Promise<boolean> {
    return this.repos.spaceApiHosts.any();
  }

  async create(scope: Scope, hostname: string): Promise<ApiHostView> {
    const [row] = await this.add(scope, [hostname]);
    return (await this.views([row as SpaceApiHostRow]))[0] as ApiHostView;
  }

  async delete(scope: Scope, id: string): Promise<void> {
    const row = await this.find(scope, id);
    await this.repos.transaction(async (tx) => {
      await tx.spaceApiHosts.delete(id, scope);
      await this.audit.in(tx).record('apiHost.delete', row, snapshotChanges(row, 'deleted'));
      await this.hostEvent('domain.removed', row, tx);
      await this.purge(tx, scopeSpaceId(scope));
      await this.afterCommit(tx, 'apiHost:afterDelete', row);
    });
  }

  async verify(scope: Scope, id: string): Promise<ApiHostView> {
    const row = await this.verifier.check('api', await this.find(scope, id));
    return (await this.views([row]))[0] as ApiHostView;
  }

  /** Makes the environment's hosts exactly `hostnames`; kept ones keep their verification. */
  async replace(scope: Scope, hostnames: readonly string[]): Promise<ApiHostView[]> {
    const wanted = hostnames.map((input, index) => this.normalised(input, [index]));
    const current = await this.repos.spaceApiHosts.listBySpace(scope);
    const added = [...new Set(wanted)].filter(
      (name) => !current.some((row) => row.hostname === name),
    );
    for (const row of current) {
      if (!wanted.includes(row.hostname)) await this.delete(scope, row.id);
    }
    if (added.length > 0) await this.add(scope, added);
    return this.list(scope);
  }

  /** Refuses names that are not host names or that another host already uses. */
  async assertFree(hostnames: readonly string[]): Promise<void> {
    for (const [index, input] of hostnames.entries()) {
      const hostname = this.normalised(input, [index]);
      if (await this.taken(hostname)) invalidTaken(hostname, [index]);
    }
  }

  // -------------------------------------------------------------------------

  private async add(scope: Scope, inputs: readonly string[]): Promise<SpaceApiHostRow[]> {
    const spaceId = scopeSpaceId(scope);
    await this.manablox.controls.assertFeature(spaceId, 'customDomains');
    if (!(await this.repos.spaces.findById(spaceId))) {
      throw ManabloxError.notFound('space.notFound', { spaceId });
    }
    const single = inputs.length === 1;
    const names = inputs.map((input, index) =>
      this.normalised(input, single ? ['hostname'] : [index]),
    );
    for (const [index, hostname] of names.entries()) {
      if (await this.taken(hostname)) invalidTaken(hostname, single ? ['hostname'] : [index]);
    }
    await this.manablox.controls.assertLimit(scope, 'customDomains', {
      increment: names.length,
    });
    const verification = await this.verifier.initial();
    return this.repos.transaction(async (tx) => {
      const rows: SpaceApiHostRow[] = [];
      for (const hostname of names) {
        const row = await tx.spaceApiHosts
          .create(scope, { hostname, ...verification })
          .catch(hostnameConflict({ hostname }));
        await this.audit.in(tx).record('apiHost.create', row, snapshotChanges(row, 'created'));
        await this.hostEvent('domain.added', row, tx);
        await this.afterCommit(tx, 'apiHost:afterCreate', row);
        rows.push(row);
      }
      await this.purge(tx, spaceId);
      return rows;
    });
  }

  private normalised(input: string, path: Array<string | number>): string {
    const hostname = normaliseHostname(input);
    if (!hostname) throw invalid('apiHost.hostname.invalid', path, input);
    return hostname;
  }

  /** Used by a host of any source. */
  private async taken(hostname: string): Promise<boolean> {
    return (await this.verifier.owner(hostname)) !== null;
  }

  private async find(scope: Scope, id: string): Promise<SpaceApiHostRow> {
    return requireInSpace(
      await this.repos.spaceApiHosts.findById(id, scope),
      scope,
      'apiHost.notFound',
      { id },
    );
  }

  private async views(rows: SpaceApiHostRow[]): Promise<ApiHostView[]> {
    const required = await this.verifier.required();
    return rows.map((row) => ({ ...row, verification: this.verifier.view(row, required) }));
  }

  private async hostEvent(
    type: 'domain.added' | 'domain.removed',
    row: SpaceApiHostRow,
    tx: Repositories,
  ): Promise<void> {
    return this.manablox.controls.emit(
      type,
      { kind: 'space', id: row.spaceId },
      {
        spaceId: row.spaceId,
        ...(await environmentPayload(tx, row)),
        domainId: row.id,
        hostname: row.hostname,
        kind: 'api',
      },
      { tx },
    );
  }

  /** Runs the observing hook once the write committed. */
  private afterCommit(
    tx: Repositories,
    hook: 'apiHost:afterCreate' | 'apiHost:afterDelete',
    row: SpaceApiHostRow,
  ): Promise<void> {
    return whenCommitted(tx, () =>
      this.manablox.hooks.observe(
        hook,
        { id: row.id, spaceId: row.spaceId, hostname: row.hostname },
        { manablox: this.manablox, spaceId: row.spaceId },
      ),
    );
  }

  private purge(repos: Repositories, spaceId: string): Promise<void> {
    return whenCommitted(repos, () => purgeTags(this.manablox, spaceId, [API_HOSTS_CACHE_TAG]));
  }
}

function invalidTaken(hostname: string, path: Array<string | number>): never {
  throw invalid('apiHost.hostname.taken', path, hostname);
}
