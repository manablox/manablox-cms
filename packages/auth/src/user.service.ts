import {
  type AuditActor,
  type AuditSink,
  auditor,
  type Controls,
  diffRecords,
  ManabloxError,
} from '@manablox/core';
import {
  type MembershipRow,
  PROVISIONED_META_KEY,
  type Repositories,
  rethrowUniqueViolation,
  type SpaceRow,
  type UserRow,
  type UserUpdateData,
} from '@manablox/db';
import { hashPassword, verifyPassword } from './password.js';

export type InstanceRole = 'superadmin' | 'editor';

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: InstanceRole;
  /** The address was proven, e.g. by an invitation link. */
  emailVerified?: boolean | undefined;
}

export interface UpdateUserInput {
  name?: string | undefined;
  email?: string | undefined;
}

export interface UserServiceOptions {
  /** `control.provisioned`. */
  provisioned?: boolean | undefined;
  /** Checks the `seats` limit on create and records account events; read per call. */
  controls?: (() => Pick<Controls, 'assertLimit'> & Partial<Pick<Controls, 'emit'>>) | undefined;
}

/** A user row safe for directory listings. */
export interface UserSummary {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  banned: boolean;
  banReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDetail extends UserSummary {
  memberships: Array<{ spaceId: string; role: MembershipRow['role']; space: SpaceRow }>;
}

/** Maps the `users_email_key` unique violation to a validation error. */
const emailConflict = (email: string | undefined) => (error: unknown) =>
  rethrowUniqueViolation(error, {
    constraint: 'email',
    key: 'user.email.taken',
    path: ['email'],
    params: { email: email ?? '' },
    errorKey: 'user.validation.failed',
  });

/** Entries on accounts, named by the address; instance-wide, so they carry no space. */
export const userAuditor = (sink: AuditSink, actor?: AuditActor) =>
  auditor(sink, 'user', (user: UserRow) => user.email, actor ? { actor } : {});

/** Accounts and instance roles; nobody can lock themself out and one superadmin always remains. */
export class UserService {
  private readonly audit;

  constructor(
    private readonly repos: Repositories,
    private readonly options: UserServiceOptions = {},
  ) {
    this.audit = userAuditor(repos);
  }

  /** The same service writing through `repos`, e.g. inside a transaction. */
  using(repos: Repositories): UserService {
    return new UserService(repos, this.options);
  }

  async get(userId: string): Promise<UserDetail> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw ManabloxError.notFound('user.notFound', { id: userId });
    const memberships = await this.repos.users.listMembershipsWithSpaces(userId);
    return {
      ...summary(user),
      memberships: memberships.map((row) => ({
        spaceId: row.spaceId,
        role: row.role,
        space: row.space,
      })),
    };
  }

  async list(pagination: { limit: number; offset: number }, search?: string) {
    const page = await this.repos.users.page(pagination, search);
    return { ...page, items: page.items.map(summary) };
  }

  async create(input: CreateUserInput): Promise<UserSummary> {
    const email = normaliseEmail(input.email);
    // A new account is a seat of the instance only; memberships count per space and group.
    await this.options.controls?.().assertLimit(null, 'seats');
    const passwordHash = await hashPassword(input.password);
    const user = await this.repos.transaction(async (tx) => {
      const row = await tx.users
        .create({
          name: input.name.trim(),
          email,
          role: input.role,
          passwordHash,
          ...(input.emailVerified ? { emailVerified: true } : {}),
        })
        .catch(emailConflict(email));
      await this.audit.in(tx).record('user.create', row, diffRecords(null, summary(row)));
      await this.options
        .controls?.()
        .emit?.(
          'user.created',
          { kind: 'instance' },
          { userId: row.id, email: row.email, role: row.role },
          { tx },
        );
      return row;
    });
    return summary(user);
  }

  async update(userId: string, input: UpdateUserInput): Promise<UserSummary> {
    const before = await this.require(userId);
    const data: UserUpdateData = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.email !== undefined) data.email = normaliseEmail(input.email);
    const user = await this.repos.users.update(userId, data).catch(emailConflict(data.email));
    await this.audit.record('user.update', user, diffRecords(summary(before), summary(user)));
    return summary(user);
  }

  /** The last superadmin cannot step down. */
  async setRole(userId: string, role: InstanceRole): Promise<UserSummary> {
    const before = await this.require(userId);
    if (role !== 'superadmin') await this.assertNotLastSuperadmin(userId);
    const user = await this.repos.users.setRole(userId, role);
    await this.audit.record('user.setRole', user, [
      { path: 'role', from: before.role, to: user.role },
    ]);
    return summary(user);
  }

  /** Admin reset; revokes every session. */
  async setPassword(userId: string, password: string): Promise<void> {
    const user = await this.require(userId);
    await this.repos.users.setPasswordHash(userId, await hashPassword(password));
    await this.repos.users.revokeSessions(userId);
    await this.audit.record('user.setPassword', user, []);
  }

  /** Self-service change; requires the current password and keeps other sessions. */
  async changePassword(userId: string, currentPassword: string, password: string): Promise<void> {
    const user = await this.require(userId);
    const stored = await this.repos.users.findPasswordHash(userId);
    if (!stored || !(await verifyPassword(stored, currentPassword))) {
      throw ManabloxError.validation(
        [{ key: 'user.password.incorrect', path: ['currentPassword'] }],
        'user.validation.failed',
      );
    }
    if (currentPassword === password) {
      throw ManabloxError.validation(
        [{ key: 'user.password.sameAsCurrent', path: ['password'] }],
        'user.validation.failed',
      );
    }
    await this.repos.users.setPasswordHash(userId, await hashPassword(password));
    await this.audit.record('user.changePassword', user, []);
  }

  /** Signs the user out everywhere; later requests are refused. */
  async ban(actorId: string, userId: string, reason: string | null): Promise<UserSummary> {
    this.assertNotSelf(actorId, userId);
    await this.assertNotLastSuperadmin(userId);
    const user = await this.repos.users.setBanned(userId, true, reason);
    await this.repos.users.revokeSessions(userId);
    await this.audit.record('user.ban', user, [
      { path: 'banned', from: false, to: true },
      { path: 'banReason', from: null, to: reason },
    ]);
    return summary(user);
  }

  async unban(userId: string): Promise<UserSummary> {
    const before = await this.require(userId);
    const user = await this.repos.users.setBanned(userId, false, null);
    await this.audit.record('user.unban', user, [
      { path: 'banned', from: before.banned, to: false },
      { path: 'banReason', from: before.banReason, to: null },
    ]);
    return summary(user);
  }

  async delete(actorId: string, userId: string): Promise<void> {
    this.assertNotSelf(actorId, userId);
    const user = await this.require(userId);
    await this.assertNotLastSuperadmin(userId);
    const controls = this.options.controls?.();
    await this.repos.transaction(async (tx) => {
      const spaceIds = controls?.emit
        ? (await tx.users.listMembershipsWithSpaces(userId)).map((row) => row.spaceId)
        : [];
      await tx.users.delete(userId);
      await this.audit.in(tx).record('user.delete', user, diffRecords(summary(user), null));
      await controls?.emit?.(
        'user.deleted',
        { kind: 'instance' },
        { userId, email: user.email },
        { tx },
      );
      for (const spaceId of spaceIds) {
        await controls?.emit?.(
          'seat.changed',
          { kind: 'space', id: spaceId },
          {
            spaceId,
            change: 'removed',
            userIds: [userId],
            members: await tx.limitCounts.seats([spaceId]),
          },
          { tx },
        );
      }
    });
  }

  /** Signs the user out of every device. */
  async revokeSessions(userId: string): Promise<void> {
    const user = await this.require(userId);
    await this.repos.users.revokeSessions(userId);
    await this.audit.record('user.revokeSessions', user, []);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async require(userId: string): Promise<UserRow> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw ManabloxError.notFound('user.notFound', { id: userId });
    return user;
  }

  private assertNotSelf(actorId: string, userId: string): void {
    if (actorId === userId) throw ManabloxError.badRequest('user.self.protected', { id: userId });
  }

  /** One superadmin must always remain. */
  private async assertNotLastSuperadmin(userId: string): Promise<void> {
    const user = await this.require(userId);
    if (user.role !== 'superadmin') return;
    const count = await this.repos.users.countByRole('superadmin');
    if (count <= 1) throw ManabloxError.badRequest('user.lastSuperadmin', { id: userId });
  }

  /** The stored account, or `null`. */
  find(userId: string): Promise<UserRow | null> {
    return this.repos.users.findById(userId);
  }

  /** The account's stored admin preference, or `null` until it is set. */
  preference<T = unknown>(userId: string, key: string): Promise<T | null> {
    return this.repos.userPreferences.get<T>(userId, key);
  }

  async setPreference(userId: string, key: string, value: unknown): Promise<void> {
    await this.repos.userPreferences.set(userId, key, value);
  }

  /** Whether the instance has no account yet and makes its first one itself. */
  async setupNeeded(): Promise<boolean> {
    return (await this.repos.users.count()) === 0 && !(await this.provisioned());
  }

  /** Whether the control API provides the accounts: configured, or since it created the owner. */
  async provisioned(): Promise<boolean> {
    if (this.options.provisioned) return true;
    return (await this.repos.instanceMeta.get(PROVISIONED_META_KEY)) !== null;
  }
}

function summary(user: UserRow): UserSummary {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    role: user.role,
    banned: user.banned,
    banReason: user.banReason,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/** Lower-cased and trimmed, as better-auth stores it. */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
