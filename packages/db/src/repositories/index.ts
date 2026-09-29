import type { ContentTypeRegistry } from '@manablox/core';
import type { Database } from '../client.js';
import { ApiKeyRepository } from './api-key.js';
import { AssetRepository } from './asset.js';
import { AssetUsageRepository } from './asset-usage.js';
import { type AuditAppendInput, AuditRepository, type AuditRepositoryOptions } from './audit.js';
import type { DatabaseContext, UnitOfWork } from './base.js';
import { ContentRepository } from './content.js';
import { ContentApprovalRepository } from './content-approval.js';
import { ContentTypeRepository } from './content-type.js';
import { ControlEventRepository } from './control-event.js';
import { ControlSettingRepository } from './control-setting.js';
import { CredentialRepository } from './credential.js';
import { EnvironmentRepository } from './environment.js';
import { EnvironmentRowsRepository } from './environment-rows.js';
import { InstanceMetaRepository } from './instance-meta.js';
import { InvitationRepository } from './invitation.js';
import { LimitCountRepository } from './limit-count.js';
import { LockRepository } from './lock.js';
import { MenuRepository } from './menu.js';
import { NotificationRepository } from './notification.js';
import { PluginSettingsRepository } from './plugin-settings.js';
import { PushSubscriptionRepository } from './push-subscription.js';
import { RedirectRepository } from './redirect.js';
import { RoleRepository } from './role.js';
import { SpaceRepository } from './space.js';
import { SpaceApiHostRepository } from './space-api-host.js';
import { SpaceGroupRepository } from './space-group.js';
import { SsoProviderRepository } from './sso-provider.js';
import { TagRepository } from './tag.js';
import { UsageCounterRepository } from './usage-counter.js';
import { UsageExternalRepository } from './usage-external.js';
import { UserRepository } from './user.js';
import { UserPreferenceRepository } from './user-preference.js';

export interface Repositories {
  apiKeys: ApiKeyRepository;
  content: ContentRepository;
  contentTypes: ContentTypeRepository;
  spaces: SpaceRepository;
  environments: EnvironmentRepository;
  /** Raw environment rows for copying and promoting environments. */
  environmentRows: EnvironmentRowsRepository;
  assets: AssetRepository;
  assetUsages: AssetUsageRepository;
  tags: TagRepository;
  users: UserRepository;
  menus: MenuRepository;
  roles: RoleRepository;
  /** The credential vault (`credentials`). */
  credentials: CredentialRepository;
  pushSubscriptions: PushSubscriptionRepository;
  audit: AuditRepository;
  locks: LockRepository;
  notifications: NotificationRepository;
  approvals: ContentApprovalRepository;
  /** Plugin settings per space environment. */
  pluginSettings: PluginSettingsRepository;
  spaceApiHosts: SpaceApiHostRepository;
  redirects: RedirectRepository;
  controlSettings: ControlSettingRepository;
  spaceGroups: SpaceGroupRepository;
  usageCounters: UsageCounterRepository;
  usageExternal: UsageExternalRepository;
  controlEvents: ControlEventRepository;
  instanceMeta: InstanceMetaRepository;
  invitations: InvitationRepository;
  ssoProviders: SsoProviderRepository;
  userPreferences: UserPreferenceRepository;
  limitCounts: LimitCountRepository;
  /**
   * Runs `fn` in one transaction and commits when it resolves. Inside `fn` use only the repos
   * it is given: the outer ones wait for the transaction to end and would deadlock. A nested
   * call opens a savepoint.
   */
  transaction<T>(fn: (repos: TransactionRepositories) => Promise<T>): Promise<T>;
}

/** Repositories bound to an open transaction. */
export interface TransactionRepositories extends Repositories {
  /**
   * Runs `fn` once the outermost transaction commits, in order and awaited; dropped on
   * rollback. A throw surfaces from `transaction` after the rest have run.
   */
  afterCommit(fn: () => unknown): void;
  /**
   * Runs `fn` once the outermost transaction ends, after the `afterCommit` callbacks or the
   * rollback; awaited, a throw is dropped.
   */
  afterEnd(fn: () => unknown): void;
}

/** Repositories handed to a `transaction` callback. */
const transactional = new WeakSet<object>();

/** Whether `repos` is bound to an open transaction. */
export function inTransaction(repos: Repositories): repos is TransactionRepositories {
  return transactional.has(repos);
}

/** The repositories a transaction was opened on, for work after it commits. */
const roots = new WeakMap<object, Repositories>();

/** The repositories outside any transaction that `repos` belongs to; `repos` itself outside one. */
export function rootRepositories(repos: Repositories): Repositories {
  return roots.get(repos) ?? repos;
}

/** The database context each set of repositories is built on. */
const contexts = new WeakMap<object, DatabaseContext>();

/**
 * The context `repos` is bound to, for plugin repositories: inside `repos.transaction` it is
 * the transaction, so their writes commit and roll back with the core ones.
 */
export function databaseContextOf(repos: Repositories): DatabaseContext {
  const context = contexts.get(repos);
  if (!context) throw new Error('repositories not built by createRepositories');
  return context;
}

/**
 * A plugin's repositories on the connection or transaction `repos` is bound to, built once
 * per `repos` by `build`:
 *
 * ```ts
 * export const helloRepos = pluginRepos((context) => ({ greetings: new GreetingRepository(context) }));
 * ```
 */
export function pluginRepos<R>(build: (context: DatabaseContext) => R): (repos: Repositories) => R {
  const built = new WeakMap<Repositories, R>();
  return (repos) => {
    let own = built.get(repos);
    if (own === undefined) {
      own = build(databaseContextOf(repos));
      built.set(repos, own);
    }
    return own;
  };
}

/** Runs `fn` once `repos`' transaction commits, or now outside one. */
export async function whenCommitted(repos: Repositories, fn: () => unknown): Promise<void> {
  if (inTransaction(repos)) repos.afterCommit(fn);
  else await fn();
}

export interface RepositoriesOptions {
  audit?: AuditRepositoryOptions | undefined;
}

export function createRepositories(
  context: DatabaseContext,
  registry: ContentTypeRegistry,
  options: RepositoriesOptions = {},
): Repositories {
  return build(context, registry, options, undefined, undefined);
}

/** The outermost transaction each set of transactional repositories belongs to. */
const outermost = new WeakMap<object, object>();

/** One key per outermost transaction, shared by its savepoints. */
export function transactionKey(repos: TransactionRepositories): object {
  const key = outermost.get(repos);
  if (!key) throw new Error('repositories not bound to a transaction');
  return key;
}

/** Callbacks queued by one transaction or savepoint. */
class Unit implements UnitOfWork {
  readonly queued: Array<() => unknown> = [];
  readonly audits: AuditAppendInput[] = [];
  readonly ended: Array<() => unknown> = [];

  afterCommit(fn: () => unknown): void {
    this.queued.push(fn);
  }

  appendAudit(input: AuditAppendInput): void {
    this.audits.push(input);
  }

  async flush(): Promise<void> {
    const errors: unknown[] = [];
    for (const fn of this.queued) {
      try {
        await fn();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw errors[0];
  }

  async end(): Promise<void> {
    for (const fn of this.ended) {
      try {
        await fn();
      } catch {
        // Clean-up only; the transaction's own outcome stands.
      }
    }
  }
}

function build(
  context: DatabaseContext,
  registry: ContentTypeRegistry,
  options: RepositoriesOptions,
  unit: Unit | undefined,
  root: Repositories | undefined,
  outer: Unit | undefined = unit,
): TransactionRepositories {
  const ctx: DatabaseContext = {
    db: context.db,
    tables: context.tables,
    dialect: context.dialect,
    unit,
  };
  const repos: TransactionRepositories = {
    apiKeys: new ApiKeyRepository(ctx),
    content: new ContentRepository(ctx, registry),
    contentTypes: new ContentTypeRepository(ctx),
    spaces: new SpaceRepository(ctx),
    environments: new EnvironmentRepository(ctx),
    environmentRows: new EnvironmentRowsRepository(ctx),
    assets: new AssetRepository(ctx),
    assetUsages: new AssetUsageRepository(ctx),
    tags: new TagRepository(ctx),
    users: new UserRepository(ctx),
    menus: new MenuRepository(ctx),
    roles: new RoleRepository(ctx),
    credentials: new CredentialRepository(ctx),
    pushSubscriptions: new PushSubscriptionRepository(ctx),
    audit: new AuditRepository(ctx, options.audit),
    locks: new LockRepository(ctx),
    notifications: new NotificationRepository(ctx),
    approvals: new ContentApprovalRepository(ctx),
    pluginSettings: new PluginSettingsRepository(ctx),
    spaceApiHosts: new SpaceApiHostRepository(ctx),
    redirects: new RedirectRepository(ctx),
    controlSettings: new ControlSettingRepository(ctx),
    spaceGroups: new SpaceGroupRepository(ctx),
    usageCounters: new UsageCounterRepository(ctx),
    usageExternal: new UsageExternalRepository(ctx),
    controlEvents: new ControlEventRepository(ctx),
    instanceMeta: new InstanceMetaRepository(ctx),
    invitations: new InvitationRepository(ctx),
    ssoProviders: new SsoProviderRepository(ctx),
    userPreferences: new UserPreferenceRepository(ctx),
    limitCounts: new LimitCountRepository(ctx, registry),
    async transaction(fn) {
      const inner = new Unit();
      let result: Awaited<ReturnType<typeof fn>>;
      try {
        // Drizzle opens a savepoint when `db` is already a transaction.
        result = await context.db.transaction(async (tx) => {
          const bound = build(
            { ...ctx, db: tx as unknown as Database },
            registry,
            options,
            inner,
            root ?? repos,
            outer ?? inner,
          );
          const value = await fn(bound);
          // Last, so the audit chain lock is held only until commit.
          if (!unit) await bound.audit.recordNow(inner.audits.splice(0));
          return value;
        });
      } catch (error) {
        if (outer) outer.ended.push(...inner.ended);
        else await inner.end();
        throw error;
      }
      if (unit) {
        unit.queued.push(...inner.queued);
        unit.audits.push(...inner.audits);
        (outer as Unit).ended.push(...inner.ended);
        return result;
      }
      try {
        await inner.flush();
      } finally {
        await inner.end();
      }
      return result;
    },
    afterCommit(fn) {
      if (unit) unit.afterCommit(fn);
      else fn();
    },
    afterEnd(fn) {
      if (unit) unit.ended.push(fn);
      else fn();
    },
  };
  contexts.set(repos, ctx);
  if (unit) transactional.add(repos);
  if (outer) outermost.set(repos, outer);
  if (root) roots.set(repos, root);
  return repos;
}
