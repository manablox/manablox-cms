import type {
  AnyFieldType,
  ContentTypeInput,
  ControlScope,
  DatabaseDialect,
  FeatureControl,
  FeatureKey,
  ManabloxConfig,
} from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import {
  createDatabase,
  createRepositories,
  type DatabaseHandle,
  type Repositories,
} from '@manablox/db';
import { createTestDatabase } from '@manablox/db/testing';
import { ApiHostService } from './api-host.service.js';
import { ApprovalService } from './approval.service.js';
import { AuditService } from './audit.service.js';
import { SpaceConfigService } from './config/service.js';
import { ContentService } from './content/service.js';
import { ContentTypeService } from './content-type.service.js';
import {
  ControlService,
  type ControlSettings,
  type ControlStore,
  installControls,
} from './controls/index.js';
import { HostVerifier } from './host-verification.js';
import { loadInstance } from './instance.js';
import { createLoaders, type Loaders } from './loaders.js';
import { MenuService } from './menu.service.js';
import { type NotificationChannels, NotificationService } from './notification.service.js';
import { RealtimeService } from './realtime.service.js';
import { RedirectService } from './redirect.service.js';
import { RoleService } from './role.service.js';
import { SpaceService } from './space.service.js';
import { TagService } from './tag.service.js';
import { SpaceTransferService } from './transfer/service.js';
import type { ImportStorage } from './transfer/staging.js';

export interface ServiceContext {
  manablox: Manablox;
  handle: DatabaseHandle;
  repos: Repositories;
  content: ContentService;
  contentTypes: ContentTypeService;
  menus: MenuService;
  roles: RoleService;
  spaces: SpaceService;
  tags: TagService;
  audit: AuditService;
  realtime: RealtimeService;
  notifications: NotificationService;
  approvals: ApprovalService;
  redirects: RedirectService;
  apiHosts: ApiHostService;
  /** Shared by the host sources; swap its `resolver` for a fake. */
  hostVerifier: HostVerifier;
  /** Also installed as `manablox.controls`. */
  controlStore: ControlStore;
  controls: ControlService;
  loaders: Loaders;
  spaceId: string;
  /** Content type ids by name. */
  ids: Record<string, string>;
  /** Number of SQL statements issued since the last reset. */
  queryCount: () => number;
  resetQueryCount: () => void;
  /** SQL statements issued since the last reset. */
  queries: () => readonly string[];
  close: () => Promise<void>;
}

export interface ServiceContextOptions {
  /** Field types to register. */
  fieldTypes: AnyFieldType[];
  /** Code-defined content types, block types first. */
  contentTypes: ContentTypeInput[];
  /** Other instance config. */
  config?: Partial<Omit<ManabloxConfig, 'database' | 'fieldTypes' | 'contentTypes'>>;
  /** Mail and push senders. */
  channels?: NotificationChannels;
  /** Stages space imports. */
  storage?: ImportStorage;
  /** Defaults to `TEST_DATABASE_DIALECT`. */
  dialect?: DatabaseDialect;
}

/** A full service layer over a fresh database with one space, hooks wired as in the host. */
export async function createServiceContext(
  name: string,
  options: ServiceContextOptions,
): Promise<ServiceContext> {
  const database = await createTestDatabase(`svc_${name}`, {
    ...(options.dialect ? { dialect: options.dialect } : {}),
    ...(options.config?.plugins ? { plugins: options.config.plugins } : {}),
  });

  let statements: string[] = [];
  const handle = await createDatabase(
    { url: database.url, max: 4 },
    {
      onQuery: (query) => {
        statements.push(query);
      },
    },
  );

  const manablox = new Manablox({
    ...options.config,
    database: { url: database.url },
    auth: { secret: 'test', ...options.config?.auth },
    fieldTypes: options.fieldTypes,
    contentTypes: options.contentTypes,
    logLevel: options.config?.logLevel ?? 'silent',
  } as ManabloxConfig);
  await manablox.init();

  const realtime = new RealtimeService(manablox);
  const repos = createRepositories(handle, manablox.contentTypes, {
    audit: { onAppended: (row) => realtime.publishAudit(row) },
  });
  await loadInstance(manablox, repos);
  const space = await repos.spaces.create({ name: 'S', machineName: 's', url: 'http://x' });
  const controlStore = installControls(manablox, repos);
  const roles = new RoleService(manablox, repos);
  const spaces = new SpaceService(
    manablox,
    repos,
    roles,
    new SpaceTransferService(manablox, repos, options.storage ?? null),
    new SpaceConfigService(manablox, repos),
  );
  const menus = new MenuService(manablox, repos);
  const tags = new TagService(manablox, repos);
  const content = new ContentService(manablox, repos);
  const notifications = new NotificationService(manablox, repos, realtime, options.channels ?? {});
  const approvals = new ApprovalService(manablox, repos, content, notifications);
  menus.attach();
  tags.attach();
  spaces.attach();
  notifications.attach();
  approvals.attach();

  const ids: Record<string, string> = {};
  for (const type of options.contentTypes)
    ids[type.name] = manablox.contentTypes.getByName(type.name).id;

  const hostVerifier = new HostVerifier(manablox, repos);
  return {
    manablox,
    handle,
    repos,
    content,
    contentTypes: new ContentTypeService(manablox, repos, roles),
    menus,
    roles,
    spaces,
    tags,
    audit: new AuditService(manablox, repos),
    realtime,
    notifications,
    approvals,
    redirects: new RedirectService(manablox, repos),
    apiHosts: new ApiHostService(manablox, repos, hostVerifier),
    hostVerifier,
    controlStore,
    controls: new ControlService(manablox, repos, controlStore),
    loaders: createLoaders(repos),
    spaceId: space.id,
    ids,
    queryCount: () => statements.length,
    queries: () => statements,
    resetQueryCount: () => {
      statements = [];
    },
    close: async () => {
      await notifications.settle();
      await handle.close();
      await database.drop();
    },
  };
}

export interface WithControlsOptions {
  /** Defaults to the instance. */
  scope?: ControlScope;
  /** By short key; `false` switches the feature off. */
  features?: Partial<Record<FeatureKey, boolean | FeatureControl>>;
  /** By stored key, e.g. `limits.spaces`. */
  values?: ControlSettings;
}

/**
 * Sets control values at one scope through the control service, so the cached controls are
 * purged. Returns a restore that puts the scope's earlier values back.
 */
export async function withControls(
  ctx: Pick<ServiceContext, 'controls'>,
  options: WithControlsOptions,
): Promise<() => Promise<void>> {
  const scope = options.scope ?? { kind: 'instance' };
  const before = await ctx.controls.settings(scope);
  const values: ControlSettings = { ...options.values };
  for (const [key, value] of Object.entries(options.features ?? {})) {
    values[`features.${key}`] = typeof value === 'boolean' ? { enabled: value } : value;
  }
  await ctx.controls.patch(scope, values);
  return async () => {
    await ctx.controls.replaceScope(scope, before);
  };
}

/** A new space group holding `spaceIds`; its scope for `withControls`. */
export async function spaceGroup(
  ctx: Pick<ServiceContext, 'controls'>,
  spaceIds: readonly string[],
  name = 'Group',
): Promise<{ kind: 'group'; id: string }> {
  const group = await ctx.controls.createGroup({ name });
  await ctx.controls.assignSpaces({ id: group.id }, spaceIds);
  return { kind: 'group', id: group.id };
}
