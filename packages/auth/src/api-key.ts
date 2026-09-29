import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type Auditor, auditor, ManabloxError } from '@manablox/core';
import type { Logger, Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { Principal, SpaceRole } from './rbac.js';

export interface IssuedApiKey {
  id: string;
  name: string;
  /** The full secret, shown once. */
  key: string;
  prefix: string;
}

export interface IssueApiKeyOptions {
  expiresAt?: Date | undefined;
  /** Spaces the key may act in; `null`/omitted for all. */
  spaceIds?: string[] | null | undefined;
  /** Environment ids the key may address; `null`/omitted for every environment. */
  environmentIds?: string[] | null | undefined;
  /** Grants the key may use; `null`/omitted for the owner's role. */
  permissions?: string[] | null | undefined;
}

const PREFIX = 'mbx';

/** Splits `mbx_<12 hex prefix>_<secret>`; the base64url secret may contain `_`. */
export function parseApiKey(presented: string): { prefix: string; secret: string } | null {
  const match = /^([a-z]+)_([0-9a-f]{12})_([A-Za-z0-9_-]+)$/.exec(presented);
  if (!match || match[1] !== PREFIX) return null;
  return { prefix: match[2] as string, secret: match[3] as string };
}

/** API keys, stored as SHA-256 digests and looked up by an indexed non-secret prefix. */
export class ApiKeyService {
  private readonly audit: Auditor<ApiKeyAuditRow>;

  constructor(
    private readonly repos: Repositories,
    private readonly logger?: Logger | undefined,
    /** Runs `apiKey:beforeIssue` and reads `apiKeysDisable`. */
    private readonly manablox?: Manablox | undefined,
  ) {
    this.audit = auditor(repos, 'apiKey', (row: ApiKeyAuditRow) => row.name, {
      meta: (row) => (row.userId ? { userId: row.userId } : {}),
    });
  }

  async issue(
    userId: string,
    name: string,
    options: IssueApiKeyOptions = {},
  ): Promise<IssuedApiKey> {
    const spaceIds = options.spaceIds?.length ? options.spaceIds : null;
    const environmentIds = options.environmentIds?.length ? options.environmentIds : null;
    const manablox = this.manablox;
    if (manablox) {
      await manablox.hooks.run(
        'apiKey:beforeIssue',
        {
          userId,
          name,
          spaceIds,
          permissions: options.permissions ?? null,
          expiresAt: options.expiresAt ?? null,
        },
        { manablox },
      );
      await manablox.controls.assertLimit(null, 'apiKeys');
    }
    const secret = randomBytes(32).toString('base64url');
    const prefix = randomBytes(6).toString('hex');
    const key = `${PREFIX}_${prefix}_${secret}`;

    const row = await this.repos.apiKeys.create({
      userId,
      name,
      prefix,
      start: key.slice(0, 12),
      key: digest(secret),
      expiresAt: options.expiresAt ?? null,
      spaceIds,
      environmentIds,
      permissions: options.permissions ?? null,
    });

    if (!row) throw new ManabloxError('apiKey.create.failed');
    await this.audit.record('apiKey.issue', row, [
      { path: 'expiresAt', from: null, to: row.expiresAt },
      { path: 'spaceIds', from: null, to: row.spaceIds },
      ...(row.environmentIds
        ? [{ path: 'environmentIds', from: null, to: row.environmentIds }]
        : []),
      { path: 'permissions', from: null, to: row.permissions },
    ]);
    return { id: row.id, name, key, prefix };
  }

  /** Deletes the row; a revoked key is never re-enabled. */
  async revoke(id: string): Promise<void> {
    const row = await this.repos.apiKeys.deleteReturning(id);
    if (!row) return;
    await this.audit.record('apiKey.revoke', row);
  }

  async list(userId: string) {
    return this.repos.apiKeys.listByUser(userId);
  }

  async resolve(presented: string): Promise<Principal | null> {
    const parsed = parseApiKey(presented);
    if (!parsed) return null;
    // `apiKeysDisable` refuses every key; the resolution is cached.
    if (this.manablox && (await this.manablox.controls.resolved(null)).settings.apiKeysDisable) {
      return null;
    }
    const { prefix, secret } = parsed;

    const row = await this.repos.apiKeys.findEnabledByPrefix(prefix);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

    const expected = Buffer.from(row.key, 'hex');
    const actual = Buffer.from(digest(secret), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    // Best-effort; must never fail the request.
    void this.repos.apiKeys
      .touch(row.id, new Date())
      .catch((err: unknown) =>
        this.logger?.debug({ err, apiKeyId: row.id }, 'api key last-used not stamped'),
      );

    const user = await this.repos.users.findById(row.userId);
    if (!user || user.banned) return null;

    const resolved = await this.repos.users.findPrincipal(user.id);
    if (!resolved) return null;
    const allowed = row.spaceIds?.length ? new Set(row.spaceIds) : null;
    const spaces: Record<string, SpaceRole> = {};
    const permissions: Record<string, string[]> = {};
    for (const [spaceId, role] of Object.entries(resolved.spaces)) {
      if (allowed && !allowed.has(spaceId)) continue;
      spaces[spaceId] = role;
      const grants = resolved.permissions[spaceId];
      if (grants) permissions[spaceId] = grants;
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      spaces,
      permissions,
      viaApiKey: true,
      apiKeyId: row.id,
      apiKeyName: row.name,
      allowedSpaceIds: allowed ? [...allowed] : null,
      allowedEnvironmentIds: row.environmentIds?.length ? row.environmentIds : null,
      allowedGrants: row.permissions,
    };
  }

  /** Removes expired keys; scheduled by the jobs package. */
  async pruneExpired(): Promise<number> {
    const deleted = await this.repos.apiKeys.deleteExpiredReturning();
    if (deleted.length) {
      await this.audit.record('apiKey.prune', { id: null, name: null }, undefined, {
        removed: deleted.map((row) => ({ id: row.id, name: row.name })),
      });
    }
    return deleted.length;
  }
}

/** What an api key entry names; the prune entry names no key. */
type ApiKeyAuditRow = { id: string | null; name: string | null; userId?: string };

const digest = (secret: string): string => createHash('sha256').update(secret).digest('hex');
