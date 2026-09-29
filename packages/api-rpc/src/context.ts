import type {
  ApiKeyService,
  EmailVerificationService,
  InvitationService,
  ManabloxAuth,
  Principal,
  SsoService,
  TwoFactorService,
  UserService,
} from '@manablox/auth';
import type { ResolvedScope } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { MediaService } from '@manablox/media';
import type {
  ApiHostService,
  ApprovalService,
  AuditService,
  CodeResourceService,
  ContentService,
  ContentTypeService,
  CredentialService,
  EnvironmentLifecycleService,
  EnvironmentService,
  Loaders,
  MenuService,
  NotificationService,
  RedirectService,
  RoleService,
  SnapshotService,
  SpaceService,
  TagService,
} from '@manablox/services';

/** The runtime slice the procedures use; the host's `Runtime` extends it. */
export interface RpcRuntime {
  manablox: Manablox;
  repos: Repositories;
  auth: ManabloxAuth;
  apiKeys: ApiKeyService;
  media: MediaService;
  content: ContentService;
  contentTypes: ContentTypeService;
  spaces: SpaceService;
  /** A space's environments; resolves each request's. */
  environments: EnvironmentService;
  users: UserService;
  invitations: InvitationService;
  emailVerification: EmailVerificationService;
  twoFactor: TwoFactorService;
  sso: SsoService;
  menus: MenuService;
  tags: TagService;
  roles: RoleService;
  credentials: CredentialService;
  codeResources: CodeResourceService;
  audit: AuditService;
  notifications: NotificationService;
  approvals: ApprovalService;
  /** Built from `manablox` and `repos` when the host does not provide them. */
  apiHosts?: ApiHostService | undefined;
  redirects?: RedirectService | undefined;
  /** Space snapshots; the `snapshots` procedures refuse without it. */
  snapshots?: SnapshotService | undefined;
  /** Creating, promoting and deleting environments; those procedures refuse without it. */
  environmentLifecycle?: EnvironmentLifecycleService | undefined;
}

/** The fields of `RpcRuntime`, in declaration order. */
export const RPC_RUNTIME_KEYS = [
  'manablox',
  'repos',
  'auth',
  'apiKeys',
  'media',
  'content',
  'contentTypes',
  'spaces',
  'environments',
  'users',
  'invitations',
  'emailVerification',
  'twoFactor',
  'sso',
  'menus',
  'tags',
  'roles',
  'credentials',
  'codeResources',
  'audit',
  'notifications',
  'approvals',
  'apiHosts',
  'redirects',
  'snapshots',
  'environmentLifecycle',
] as const satisfies readonly (keyof RpcRuntime)[];

export type RpcRuntimeKey = (typeof RPC_RUNTIME_KEYS)[number];

// Fails to compile when a field is added to RpcRuntime but not to RPC_RUNTIME_KEYS.
const _everyKeyListed: [Exclude<keyof RpcRuntime, RpcRuntimeKey>] extends [never] ? true : never =
  true;

/** The runtime's RPC-facing slice: only the listed fields, so a host's extras never leak in. */
export function pickRpcRuntime(runtime: RpcRuntime): RpcRuntime {
  return pick(runtime, RPC_RUNTIME_KEYS);
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const picked = {} as Pick<T, K>;
  for (const key of keys) picked[key] = source[key];
  return picked;
}

/** What a scoped procedure tells the transport about the request, for `request:served`. */
export interface RpcRequestScope {
  spaceId: string | null;
  /** The procedure needs a `:read` permission. */
  read: boolean;
}

export interface RpcContext extends RpcRuntime {
  loaders: Loaders;
  principal: Principal | null;
  headers: Headers;
  /** Filled by scoped procedures when the transport passes it. */
  scope?: RpcRequestScope | undefined;
  /** The request's environment; set by `scoped()` when the input names a space. */
  env?: ResolvedScope | undefined;
}
