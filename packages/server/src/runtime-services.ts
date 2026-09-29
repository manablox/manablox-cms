import {
  ApiKeyService,
  type AuthCallbacks,
  AuthMailSender,
  createAuth,
  EmailVerificationService,
  InvitationService,
  type ManabloxAuth,
  PasswordResetService,
  promoteFirstUser,
  SsoService,
  TwoFactorService,
  UserService,
} from '@manablox/auth';
import {
  type KeyLock,
  memoryRateLimitStore,
  type RateLimitStore,
  redisHub,
  redisKeyLock,
  redisRateLimitStore,
  type TaggedCache,
} from '@manablox/cache';
import { type AuditActor, auditor } from '@manablox/core';
import { configuredSafeFetch, type Manablox } from '@manablox/core/node';
import type { DatabaseHandle, Repositories } from '@manablox/db';
import { declaredImageSizes } from '@manablox/fields';
import {
  createJobRunner,
  type JobHandlers,
  type JobRunner,
  mediaDeriveJobOptions,
} from '@manablox/jobs';
import { MediaService } from '@manablox/media';
import {
  ApiHostService,
  ApprovalService,
  AuditService,
  CodeResourceService,
  ContentService,
  ContentTypeService,
  ControlEventDelivery,
  ControlService,
  type ControlStore,
  CredentialService,
  createPusher,
  EnvironmentLifecycleService,
  EnvironmentService,
  HostVerifier,
  type Mailer,
  MenuService,
  NotificationService,
  type Pusher,
  pruneControlEvents,
  pruneRetention,
  type RealtimeService,
  RedirectService,
  RoleService,
  reconcileTotals,
  ScheduleService,
  SnapshotService,
  SpaceConfigService,
  SpaceService,
  SpaceTransferService,
  TagService,
} from '@manablox/services';
import { createStorageDriver, type StorageDriver } from '@manablox/storage';

/** Services every instance builds. */
export interface RuntimeBase {
  manablox: Manablox;
  handle: DatabaseHandle;
  repos: Repositories;
  auth: ManabloxAuth;
  apiKeys: ApiKeyService;
  cache: TaggedCache;
  /** Feature flags and limits from `control_settings`, also at `manablox.controls`. */
  controlStore: ControlStore;
  /** Rate counters, slots and auth backoff; Redis when replicas share it, else in process. */
  rateLimitStore?: RateLimitStore | undefined;
  storage: StorageDriver;
  media: MediaService;
  content: ContentService;
  contentTypes: ContentTypeService;
  spaces: SpaceService;
  /** A space's environments; production cached per process. */
  environments: EnvironmentService;
  users: UserService;
  /** Reset mails and one-time set-password links. */
  passwordResets: PasswordResetService;
  /** Email confirmation links. */
  emailVerification: EmailVerificationService;
  /** The two-factor policy and its audit and mails. */
  twoFactor: TwoFactorService;
  /** SSO providers and their sign-in rules. */
  sso: SsoService;
  /** Invitations by email with space grants. */
  invitations: InvitationService;
  menus: MenuService;
  tags: TagService;
  roles: RoleService;
  audit: AuditService;
  realtime: RealtimeService;
  redirects: RedirectService;
  /** Host names the public API resolves spaces from. */
  apiHosts: ApiHostService;
  /** DNS checks of custom domains and API hosts. */
  hostVerifier: HostVerifier;
  /** Space snapshots, restores and the deleted asset files kept for them. */
  snapshots: SnapshotService;
  jobs: JobRunner;
  shutdown: () => Promise<void>;
}

/** Services only a management instance builds. */
export interface ManagementServices {
  /** Control values and space groups, written by the control API. */
  controls: ControlService;
  credentials: CredentialService;
  notifications: NotificationService;
  approvals: ApprovalService;
  /** Sends mail; null without a transport. */
  mailer: Mailer | null;
  /** Sends web push; null without VAPID keys. */
  pusher: Pusher | null;
  /** Syncs config-declared resources into the database. */
  codeResources: CodeResourceService;
  /** Scheduled publishing. */
  schedule: ScheduleService;
  /** Creating, promoting and deleting environments. */
  environmentLifecycle: EnvironmentLifecycleService;
}

type AccountServices = Pick<
  RuntimeBase,
  'auth' | 'apiKeys' | 'users' | 'passwordResets' | 'emailVerification' | 'twoFactor' | 'sso'
> & { authMails: AuthMailSender };

/** Sign-in, users, API keys and the mails and policies around them. */
export function accountServices(
  manablox: Manablox,
  handle: DatabaseHandle,
  repos: Repositories,
  deps: { mailer: Mailer | null; addMembers: SpaceService['addMembers'] },
): AccountServices {
  const adminUrl = manablox.config.server.adminUrl;
  const passwordResets = new PasswordResetService(manablox, repos, {
    mailer: deps.mailer,
    adminUrl,
  });
  const authMails = new AuthMailSender(manablox, { mailer: deps.mailer, adminUrl });
  const emailVerification = new EmailVerificationService(manablox, repos, authMails);
  const twoFactor = new TwoFactorService(manablox, repos, authMails);
  const sso = new SsoService(manablox, repos, {
    spaces: { addMembers: deps.addMembers },
    secret: manablox.config.auth.secret,
  });
  const users = new UserService(repos, {
    provisioned: manablox.config.control.provisioned,
    controls: () => manablox.controls,
  });
  const auth = createAuth(manablox.config.auth, handle, {
    ...authHooks(manablox, repos, users),
    passwordResets,
    emailVerification,
    twoFactor,
    sso,
  });
  const apiKeys = new ApiKeyService(repos, manablox.logger, manablox);
  return { auth, apiKeys, users, passwordResets, emailVerification, twoFactor, sso, authMails };
}

/** Sign-up gate, first-user promotion and the sign-in audit entry. */
function authHooks(
  manablox: Manablox,
  repos: Repositories,
  users: UserService,
): Pick<AuthCallbacks, 'onUserCreated' | 'allowSignUp' | 'onSessionCreated'> {
  return {
    onUserCreated: async (userId) => {
      if (!(await users.provisioned())) await promoteFirstUser(manablox, repos, userId);
      const user = await repos.users.findById(userId);
      if (user) {
        await manablox.controls.emit(
          'user.created',
          { kind: 'instance' },
          { userId, email: user.email, role: user.role },
        );
      }
    },
    // Only the first account may sign up, and only while the control API does not provide them.
    allowSignUp: async () => (await repos.users.count()) === 0 && !(await users.provisioned()),
    onSessionCreated: async (session) => {
      const user = await repos.users.findById(session.userId);
      const actor: AuditActor = {
        kind: 'user',
        id: session.userId,
        label: user?.email ?? session.userId,
        detail: {
          ...(session.ipAddress ? { ip: session.ipAddress } : {}),
          ...(session.userAgent ? { userAgent: session.userAgent.slice(0, 300) } : {}),
        },
      };
      await auditor(repos, 'session', () => user?.email ?? null, { actor }).record(
        'session.signIn',
        { id: session.userId },
      );
    },
  };
}

/**
 * The job runner and the core handlers. Handlers read services through `runtime`, which is
 * built after the runner; only management instances run a worker.
 */
export function coreJobs(
  manablox: Manablox,
  repos: Repositories,
  controlStore: ControlStore,
  runtime: () => RuntimeBase,
) {
  const jobHandlers: JobHandlers = {
    'media:derive': (job) => runtime().media.renderVariant(job),
    'maintenance:pruneApiKeys': async () => {
      await runtime().apiKeys.pruneExpired();
    },
    'maintenance:reconcileCounters': async () => {
      const changed = await reconcileTotals(repos);
      if (changed > 0) manablox.logger.info({ changed }, 'limit counters reconciled');
    },
    'controls:flushUsage': async () => {
      await controlStore.usage?.flush();
      await controlStore.usageState?.evaluate();
    },
    'maintenance:pruneControlEvents': async () => {
      const pruned = await pruneControlEvents(manablox, repos);
      if (pruned > 0) manablox.logger.info({ pruned }, 'control events pruned');
    },
    'maintenance:retention': async () => {
      const report = await pruneRetention(manablox, repos, { storage: runtime().storage });
      if (Object.keys(report).length > 0) manablox.logger.info(report, 'retention pruned');
    },
    'maintenance:snapshots': async () => {
      const report = await runtime().snapshots.tick();
      if (Object.values(report).some((count) => count > 0)) {
        manablox.logger.info(report, 'snapshots maintained');
      }
    },
    'maintenance:verifyDomains': async () => {
      const report = await runtime().hostVerifier.sweep();
      if (report.verified > 0 || report.failed > 0) {
        manablox.logger.info(report, 'custom domains checked');
      }
    },
  };
  const isManagement = manablox.config.server.mode === 'management';
  const jobs = createJobRunner(manablox, jobHandlers, { worker: isManagement });
  const eventDelivery = controlEventDelivery(manablox, repos, jobs);
  if (eventDelivery && controlStore.events) {
    controlStore.events.onEmitted = () => eventDelivery.trigger();
    jobHandlers['controls:deliverEvents'] = async () => {
      await eventDelivery.run();
    };
    manablox.onDispose(() => eventDelivery.close());
  }
  return { jobs, jobHandlers, eventDelivery };
}

type CoreServices = Pick<
  RuntimeBase,
  | 'storage'
  | 'media'
  | 'content'
  | 'contentTypes'
  | 'spaces'
  | 'environments'
  | 'invitations'
  | 'menus'
  | 'tags'
  | 'roles'
  | 'audit'
  | 'redirects'
  | 'apiHosts'
  | 'hostVerifier'
  | 'snapshots'
>;

/** Storage, media, content, spaces and the services every instance reads through. */
export function coreServices(
  manablox: Manablox,
  repos: Repositories,
  deps: {
    jobs: JobRunner;
    controlStore: ControlStore;
    users: UserService;
    authMails: AuthMailSender;
    afterRestore: (spaceId: string) => Promise<void>;
  },
): CoreServices {
  const { jobs, controlStore } = deps;
  const isManagement = manablox.config.server.mode === 'management';
  const storage = createStorageDriver(manablox.config.storage);
  const media: MediaService = new MediaService(repos, storage, manablox.config.media, {
    maxFileSize: manablox.config.storage.maxFileSize ?? 25 * 1024 * 1024,
    allowedMimeTypes: manablox.config.storage.allowedMimeTypes ?? [],
    // Read per lookup so sizes from newly saved content types apply without a restart.
    declaredPresets: () => declaredImageSizes(manablox.contentTypes),
    readOnly: !isManagement,
    variantLock: isManagement ? createVariantLock(manablox) : undefined,
    // A worker renders eager variants after the upload returns.
    ...(jobs.inline || !isManagement
      ? {}
      : { queueDerive: (job) => jobs.enqueue('media:derive', job, mediaDeriveJobOptions(job)) }),
    manablox,
    retainDeleted: (asset, spaceIds) => snapshots.retainDeleted(asset, spaceIds),
  });

  const content = new ContentService(manablox, repos);
  const roles = new RoleService(manablox, repos);
  const contentTypes = new ContentTypeService(manablox, repos, roles);
  const transfer = new SpaceTransferService(manablox, repos, storage);
  const spaces = new SpaceService(
    manablox,
    repos,
    roles,
    transfer,
    new SpaceConfigService(manablox, repos),
  );
  const snapshots: SnapshotService = new SnapshotService(
    manablox,
    repos,
    spaces,
    transfer,
    storage,
    {
      controlStore,
      purgeOrphaned: () => media.purgeOrphaned(),
      afterRestore: deps.afterRestore,
    },
  );
  const invitations = new InvitationService(manablox, repos, {
    users: deps.users,
    spaces,
    sender: deps.authMails,
  });
  const hostVerifier = new HostVerifier(manablox, repos);
  return {
    storage,
    media,
    content,
    contentTypes,
    spaces,
    environments: new EnvironmentService(manablox, repos),
    invitations,
    menus: new MenuService(manablox, repos),
    tags: new TagService(manablox, repos),
    roles,
    audit: new AuditService(manablox, repos),
    redirects: new RedirectService(manablox, repos),
    apiHosts: new ApiHostService(manablox, repos, hostVerifier),
    hostVerifier,
    snapshots,
  };
}

/** Mail, push, the vault, notifications and approvals. */
export function managementServices(base: RuntimeBase, mailer: Mailer | null): ManagementServices {
  const { manablox, repos, content, realtime, controlStore } = base;

  const pusher = createPusher(manablox.config.push, manablox.logger);
  const notifications = new NotificationService(manablox, repos, realtime, {
    mailer,
    pusher,
    adminUrl: manablox.config.server.adminUrl,
  });
  const approvals = new ApprovalService(manablox, repos, content, notifications);

  // Encrypted with the instance secret; only the vault decrypts them.
  const credentials = new CredentialService(manablox, repos);

  // Config- and plugin-declared resources, reconciled into rows marked by `source`.
  const codeResources = new CodeResourceService(manablox, repos, { content, credentials });

  // Applies `publish_at`/`unpublish_at` through the content service, like a manual publish.
  const schedule = new ScheduleService(manablox, repos, {
    publish: (spaceId, id) => content.publish(spaceId, id),
    unpublish: (spaceId, id) => content.unpublish(spaceId, id),
  });

  return {
    controls: new ControlService(manablox, repos, controlStore),
    credentials,
    notifications,
    approvals,
    mailer,
    pusher,
    codeResources,
    schedule,
    environmentLifecycle: new EnvironmentLifecycleService(manablox, repos, {
      contentTypes: base.contentTypes,
      snapshots: base.snapshots,
      promotes: controlStore.promotes,
      afterCreate: async (spaceId) => {
        await codeResources.sync({ spaceIds: [spaceId] });
      },
    }),
  };
}

/**
 * Pushes control events to `control.webhookUrl` through the SSRF guard, with the webhook's
 * host allowed; `null` without a URL. With Redis a run is queued for the worker.
 */
function controlEventDelivery(
  manablox: Manablox,
  repos: Repositories,
  jobs: JobRunner,
): ControlEventDelivery | null {
  const { webhookUrl, webhookSecret } = manablox.config.control;
  if (!webhookUrl || !webhookSecret) return null;
  return new ControlEventDelivery(manablox, repos, {
    url: webhookUrl,
    secret: webhookSecret,
    fetch: configuredSafeFetch(manablox.config.net, {
      allowHosts: [new URL(webhookUrl).host],
    }),
    queue: jobs.inline
      ? null
      : () => jobs.enqueue('controls:deliverEvents', {}, { attempts: 1, removeOnComplete: true }),
  });
}

/** Variant renders are coordinated across replicas when jobs share Redis. */
function createVariantLock(manablox: Manablox): KeyLock | undefined {
  const hub = redisHub(manablox);
  return hub ? redisKeyLock(hub.command) : undefined;
}

/** Redis-backed counters when the cache is on and has a Redis URL; otherwise per process. */
export function createRateLimitStore(manablox: Manablox): RateLimitStore {
  const hub = manablox.config.cache.enabled ? redisHub(manablox) : null;
  const store = hub ? redisRateLimitStore(hub.command) : memoryRateLimitStore();
  manablox.onDispose(() => store.close?.());
  return store;
}
