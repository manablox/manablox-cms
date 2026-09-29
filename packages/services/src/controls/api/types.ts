import type {
  ContentTypePlan,
  SpaceBlockId,
  SpaceTemplateId,
  StateControl,
  UsageLevel,
  UsageMetric,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories, SpaceCounts } from '@manablox/db';
import type { ApiHostService } from '../../api-host.service.js';
import type { ContentService } from '../../content/service.js';
import type { ContentTypeService } from '../../content-type.service.js';
import type { EnvironmentLifecycleService } from '../../environments/lifecycle.js';
import type { MenuService } from '../../menu.service.js';
import type { SnapshotService } from '../../snapshots/service.js';
import type { SpaceService } from '../../space.service.js';
import type { SpacePluginDrafts } from '../../space-plugins.js';
import type { ControlService } from '../service.js';
import type { UsageStateStore } from '../usage-state.js';

/** Account writes; `UserService` from `@manablox/auth`. */
export interface ControlUserWriter {
  using(repos: Repositories): ControlUserWriter;
  create(input: {
    name: string;
    email: string;
    password: string;
    role: 'superadmin';
    emailVerified?: boolean;
  }): Promise<{ id: string }>;
  revokeSessions(userId: string): Promise<void>;
}

/** Set-password links; `PasswordResetService` from `@manablox/auth`. */
export interface ControlPasswordLinks {
  readonly mailEnabled: boolean;
  createPasswordSetLink(
    userId: string,
    options?: { expiresIn?: number },
  ): Promise<{ url: string; expiresAt: Date }>;
  sendPasswordSetMail(
    userId: string,
    options?: { expiresIn?: number },
  ): Promise<{ expiresAt: Date }>;
}

export interface ControlApiServices {
  manablox: Manablox;
  repos: Repositories;
  controls: ControlService;
  spaces: SpaceService;
  contentTypes: ContentTypeService;
  content: ContentService;
  menus: MenuService;
  users: ControlUserWriter;
  passwordResets: ControlPasswordLinks;
  /** Runs once a provisioned space is committed, e.g. to apply code resources. */
  afterSpaceCreate?: (spaceId: string) => Promise<void>;
  /** Evaluated again after writes that change usage levels. */
  usageState?: Pick<UsageStateStore, 'evaluate' | 'scopes'> | null | undefined;
  /** Space snapshots; the snapshot endpoints refuse without it. */
  snapshots?: SnapshotService | undefined;
  /** Built from `manablox` and `repos` when absent. */
  apiHosts?: ApiHostService | undefined;
  /** Environments; the environment endpoints refuse without it. */
  environmentLifecycle?: EnvironmentLifecycleService | undefined;
}

export interface ControlGroupView {
  id: string;
  externalId: string | null;
  name: string;
  spaceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ControlSpaceView {
  id: string;
  name: string;
  machineName: string;
  description: string | null;
  url: string;
  defaultLocale: string;
  locales: string[];
  /** `ready`, or the import status while one runs or after it failed. */
  status: string;
  group: { id: string; externalId: string | null; name: string } | null;
  hosts: Array<{
    hostname: string;
    locale: string | null;
    isPrimary: boolean;
    verified: boolean;
    verificationToken: string | null;
  }>;
  /** Host names the public API answers this space on. */
  apiHosts: ControlApiHostView[];
  counts: SpaceCounts;
  createdAt: string;
  updatedAt: string;
}

export interface ControlApiHostView {
  hostname: string;
  verified: boolean;
  /** The `_manablox.<host>` TXT value while unverified. */
  verificationToken: string | null;
  createdAt: string;
}

export interface ControlSpaceInput {
  name: string;
  machineName: string;
  description?: string | null | undefined;
  url: string;
  defaultLocale: string;
  locales: string[];
  /** A website type's starter; `true` is the basic one. */
  starter?: boolean | SpaceTemplateId | undefined;
  blocks?: SpaceBlockId[] | undefined;
  /** A group ref (`<id>` or `ext:<externalId>`) to put the space in. */
  group?: string | undefined;
  apiHosts?: string[] | undefined;
  /** Plugins' create step drafts by plugin id; see `SpaceService.create`. */
  plugins?: SpacePluginDrafts | undefined;
  /** Types added after the starter, as `ContentTypeService.applyPlan` takes them. */
  plan?: ContentTypePlan | undefined;
}

export interface ControlScopeState {
  scope: string;
  /** The space's group; spaces only. */
  group?: string | null;
  state: { status: StateControl['status']; scope: string | null; message?: string };
  /** Feature keys switched off at this scope or above. */
  featuresOff: string[];
}

/** A metric that is not `ok` at a scope. */
export interface ControlUsageLevel {
  level: Exclude<UsageLevel, 'ok'>;
  used: number;
  max: number;
  resetsAt: string;
}

export interface ControlStateReport {
  version: string;
  scopes: ControlScopeState[];
  /** Metrics that are not `ok`, per scope label; scopes with none are left out. */
  usage: Record<string, Partial<Record<UsageMetric, ControlUsageLevel>>>;
}

export interface ControlUserView {
  id: string;
  email: string;
  name: string;
  /** `superadmin` or `editor`. */
  role: string;
  banned: boolean;
  /** Spaces the account is a member of. */
  memberships: number;
  /** Start of the newest stored session; `null` without one. */
  lastSignInAt: string | null;
  createdAt: string;
}

export interface ControlLinkOptions {
  /** Seconds the link stays valid. */
  expiresIn?: number | undefined;
  /** Also mail a link when mail is configured. */
  sendMail?: boolean | undefined;
}

export interface ControlPasswordLink {
  setPasswordLink: { url: string; expiresAt: string };
  /** Whether a link was also mailed. */
  mailSent: boolean;
}

export interface ControlOwnerInput extends ControlLinkOptions {
  email: string;
  name: string;
}

export interface ControlOwnerResult extends ControlPasswordLink {
  user: ControlUserView;
}
