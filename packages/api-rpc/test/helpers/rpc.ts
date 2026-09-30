import { type Principal, UserService } from '@manablox/auth';
import { DefaultControls, inScope, type Scope } from '@manablox/core';
import { ids } from '@manablox/core/testing';
import {
  RoleService,
  SpaceConfigService,
  SpaceService,
  SpaceTransferService,
} from '@manablox/services';
import { call } from '@orpc/server';
import { type Mock, vi } from 'vitest';
import type { RpcContext } from '../../src/context.js';

export function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: ids.user,
    email: 'owner@example.com',
    role: 'editor',
    spaces: { [ids.space]: 'owner' },
    ...overrides,
  };
}

export const superadmin = (): Principal =>
  principal({ role: 'superadmin', email: 'root@example.com', spaces: {} });

/** Mock repositories; unwired calls throw. */
export interface StubRepos {
  spaces: Record<
    'list' | 'listByIds' | 'findById' | 'findByMachineName' | 'create' | 'update' | 'delete',
    Mock
  >;
  users: Record<
    | 'findById'
    | 'page'
    | 'count'
    | 'countByRole'
    | 'listMembersBySpace'
    | 'listMembershipsWithSpaces'
    | 'findSpaceRole'
    | 'grant'
    | 'revoke'
    | 'setRole'
    | 'create'
    | 'update'
    | 'delete'
    | 'setBanned'
    | 'setPasswordHash'
    | 'revokeSessions',
    Mock
  >;
  content: Record<'findById', Mock>;
  roles: Record<
    | 'listBySpace'
    | 'findById'
    | 'findByMachineName'
    | 'create'
    | 'update'
    | 'delete'
    | 'countMembers'
    | 'pruneContentType',
    Mock
  >;
  audit: Record<'record' | 'append', Mock>;
  instanceMeta: Record<'get' | 'set', Mock>;
}

/** The typed mocks behind a stub context. */
export function mocks(context: RpcContext): StubRepos {
  return context.repos as unknown as StubRepos;
}

export function stubContext(overrides: Partial<RpcContext> = {}): RpcContext {
  const repos = {
    spaces: {
      list: vi.fn(),
      listByIds: vi.fn(async (spaceIds: string[]) => spaceIds.map((id) => ({ id, groupId: null }))),
      findById: vi.fn(),
      findByMachineName: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    // Not provisioned unless a test says so.
    instanceMeta: { get: vi.fn(async () => null), set: vi.fn() },
    users: {
      findById: vi.fn(),
      page: vi.fn(),
      count: vi.fn(),
      countByRole: vi.fn(),
      listMembersBySpace: vi.fn(),
      listMembershipsWithSpaces: vi.fn(),
      findSpaceRole: vi.fn(),
      grant: vi.fn(),
      revoke: vi.fn(),
      setRole: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      setBanned: vi.fn(),
      setPasswordHash: vi.fn(),
      revokeSessions: vi.fn(),
    },
    content: { findById: vi.fn() },
    controlSettings: { deleteScope: vi.fn(), storedScopes: vi.fn(async () => []) },
    usageCounters: { deleteScope: vi.fn() },
    // Seat events carry the member count.
    limitCounts: { seats: vi.fn(async () => 0) },
    roles: {
      listBySpace: vi.fn(),
      findById: vi.fn(),
      findByMachineName: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      countMembers: vi.fn(),
      pruneContentType: vi.fn(),
    },
    // Every service write ends in an audit entry; the stub swallows them.
    audit: { record: vi.fn(async () => null), append: vi.fn() },
    // Transactions run on the same mocks; after-commit work runs at once.
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(repos)),
    afterCommit: vi.fn((fn: () => unknown) => fn()),
  };

  const manablox = {
    contentTypes: {
      forSpace: () => [{ id: ids.type }],
      get: (id: string) => ({ id, requiresApproval: false }),
    },
    // Hook reports are dropped here.
    hooks: { run: async () => undefined, observe: async () => undefined },
    // Catalogue defaults unless a test swaps them.
    controls: new DefaultControls(),
    // No plugins, so only core's data providers.
    config: { plugins: [], cache: { enabled: true, ttl: 60 } },
  };
  const roles = new RoleService(manablox as never, repos as never);
  const context = {
    manablox,
    repos,
    // The real service over mocked repositories.
    spaces: new SpaceService(
      manablox as never,
      repos as never,
      roles,
      new SpaceTransferService(manablox as never, repos as never),
      new SpaceConfigService(manablox as never, repos as never),
    ),
    roles,
    users: new UserService(repos as never),
    auth: {},
    apiKeys: { list: vi.fn(), issue: vi.fn(), revoke: vi.fn() },
    // No policy, feature on.
    twoFactor: {
      settings: vi.fn(async () => ({ policy: 'off', effective: 'off', available: true })),
      requiredFor: vi.fn(async () => false),
      setPolicy: vi.fn(),
    },
    invitations: {},
    emailVerification: { requestChange: vi.fn(), confirm: vi.fn() },
    media: {},
    // Tag reads answer empty unless a test wires them.
    tags: {
      ofContent: vi.fn(async () => new Map()),
      ofAssets: vi.fn(async () => new Map()),
      setForContent: vi.fn(async () => []),
      setForAsset: vi.fn(async () => []),
    },
    content: {},
    contentTypes: {},
    // Every space answers in its production environment.
    environments: {
      forRequest: vi.fn(async (spaceId: string) => production(spaceId)),
    },
    audit: {},
    // Nothing is declared here.
    codeResources: { sync: vi.fn(async () => ({ dryRun: false, spaces: 1, changes: [] })) },
    notifications: {},
    approvals: {},
    loaders: {},
    principal: principal(),
    headers: new Headers(),
    ...overrides,
  } as unknown as RpcContext;
  // Stored-row lookups read the mocked repository, as the real service does.
  const content = context.content as unknown as Record<string, unknown>;
  content.stored ??= async (scope: Scope, id: string) => {
    const row = await (context.repos as unknown as StubRepos).content.findById(id);
    return row && inScope(row, scope) ? row : null;
  };
  return context;
}

/** The environment id the stubbed spaces answer in. */
export const PRODUCTION_ID = '00000000-0000-4000-8000-00000000e0e0';

/** The scope a stubbed request resolves for a space. */
export function production(spaceId: string) {
  return { spaceId, environmentId: PRODUCTION_ID, machineName: 'production', production: true };
}

/** Calls a procedure as the transport would, surfacing the mapped error. */
export function invoke<T>(procedure: unknown, input: unknown, context: RpcContext): Promise<T> {
  return call(procedure as never, input as never, { context }) as Promise<T>;
}

export async function failure(
  promise: Promise<unknown>,
): Promise<{ code: string; key: string; details?: Array<{ key: string; path?: unknown[] }> }> {
  try {
    await promise;
  } catch (error) {
    const e = error as {
      code: string;
      data?: { key?: string; details?: Array<{ key: string; path?: unknown[] }> };
      message: string;
    };
    return {
      code: e.code,
      key: e.data?.key ?? e.message,
      ...(e.data?.details ? { details: e.data.details } : {}),
    };
  }
  throw new Error('expected the call to fail');
}
