import { ManabloxError, type NotificationPreferences, type SpaceRole } from '@manablox/core';
import { and, asc, count, desc, eq, inArray, max, or, sql } from 'drizzle-orm';
import type { Paginated } from '../pagination.js';
import type { Pagination } from '../query.js';
import type { MembershipRow, SpaceRow, UserRow } from '../schema/index.js';
import { Repository } from './base.js';

export interface UserCreateData {
  name: string;
  email: string;
  role: string;
  /** Already hashed. */
  passwordHash: string;
  /** The address was proven, e.g. by an invitation link. */
  emailVerified?: boolean;
}

/** An account with its space count and latest stored session. */
export interface UserActivityRow extends UserRow {
  memberships: number;
  /** When the newest session still stored began; `null` without one. */
  lastSignInAt: Date | null;
}

export interface UserUpdateData {
  name?: string;
  email?: string;
  emailVerified?: boolean;
}

/** better-auth's email + password credential; sign-in needs both. */
const CREDENTIAL_PROVIDER = 'credential';
const CREDENTIAL_ISSUER = 'local:credential';

export class UserRepository extends Repository {
  findById(id: string): Promise<UserRow | null> {
    return this.findOne(this.t.users, id);
  }

  async listByIds(ids: string[]): Promise<UserRow[]> {
    const { users } = this.t;
    if (ids.length === 0) return [];
    return this.db.select().from(users).where(inArray(users.id, ids));
  }

  /** Every account holding an instance role. */
  async listByRole(role: string): Promise<UserRow[]> {
    const { users } = this.t;
    return this.db.select().from(users).where(eq(users.role, role));
  }

  findByEmail(email: string): Promise<UserRow | null> {
    const { users } = this.t;
    return this.findOneWhere(users, eq(users.email, email));
  }

  async page(pagination: Pagination, search?: string): Promise<Paginated<UserRow>> {
    const { users } = this.t;
    const where = search
      ? or(
          this.dialect.ilike(users.email, `%${search}%`),
          this.dialect.ilike(users.name, `%${search}%`),
        )
      : undefined;

    return this.paginate(users, where, desc(users.createdAt), pagination);
  }

  /** Non-members of a space matching a search. */
  async listNonMembers(
    spaceId: string,
    search: string | undefined,
    limit: number,
  ): Promise<UserRow[]> {
    const { memberships, users } = this.t;
    const notMember = sql`not exists (select 1 from ${memberships} where ${memberships.userId} = ${users.id} and ${memberships.spaceId} = ${spaceId})`;
    const where = search
      ? and(
          notMember,
          or(
            this.dialect.ilike(users.email, `%${search}%`),
            this.dialect.ilike(users.name, `%${search}%`),
          ),
        )
      : notMember;
    return this.db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(limit);
  }

  /** Every account, oldest first, with membership counts and last sign-in. */
  async listWithActivity(): Promise<UserActivityRow[]> {
    const { memberships, sessions, users } = this.t;
    const [rows, counts, signIns] = await Promise.all([
      this.db.select().from(users).orderBy(asc(users.createdAt), asc(users.id)),
      this.db
        .select({ userId: memberships.userId, count: count() })
        .from(memberships)
        .groupBy(memberships.userId),
      this.db
        .select({ userId: sessions.userId, at: max(sessions.createdAt) })
        .from(sessions)
        .groupBy(sessions.userId),
    ]);
    const countOf = new Map(counts.map((row) => [row.userId, row.count]));
    const signInOf = new Map(signIns.map((row) => [row.userId, row.at]));
    return rows.map((user) => ({
      ...user,
      memberships: countOf.get(user.id) ?? 0,
      lastSignInAt: signInOf.get(user.id) ?? null,
    }));
  }

  async count(): Promise<number> {
    const { users } = this.t;
    const rows = await this.db.select({ count: count() }).from(users);
    return rows[0]?.count ?? 0;
  }

  /** Inserts the user and its better-auth credential atomically. */
  async create(data: UserCreateData): Promise<UserRow> {
    const { accounts, users } = this.t;
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          name: data.name,
          email: data.email,
          role: data.role,
          emailVerified: data.emailVerified ?? false,
        })
        .returning();
      if (!user) throw new ManabloxError('user.create.failed');
      await tx.insert(accounts).values({
        userId: user.id,
        accountId: user.id,
        providerId: CREDENTIAL_PROVIDER,
        issuer: CREDENTIAL_ISSUER,
        password: data.passwordHash,
      });
      return user;
    });
  }

  async update(id: string, data: UserUpdateData): Promise<UserRow> {
    const { users } = this.t;
    const [row] = await this.db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('user.notFound', { id });
    return row;
  }

  /** Sessions, accounts, api keys and memberships cascade in the schema. */
  delete(id: string): Promise<boolean> {
    return this.removeOne(this.t.users, id);
  }

  async setBanned(id: string, banned: boolean, reason: string | null): Promise<UserRow> {
    const { users } = this.t;
    const [row] = await this.db
      .update(users)
      .set({ banned, banReason: banned ? reason : null, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('user.notFound', { id });
    return row;
  }

  /** Upserts the password credential. */
  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    const { accounts } = this.t;
    const updated = await this.db
      .update(accounts)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(
        and(
          eq(accounts.userId, userId),
          eq(accounts.providerId, CREDENTIAL_PROVIDER),
          eq(accounts.issuer, CREDENTIAL_ISSUER),
        ),
      )
      .returning({ id: accounts.id });
    if (updated.length) return;
    await this.db.insert(accounts).values({
      userId,
      accountId: userId,
      providerId: CREDENTIAL_PROVIDER,
      issuer: CREDENTIAL_ISSUER,
      password: passwordHash,
    });
  }

  /** Signs the user out everywhere. */
  async revokeSessions(userId: string): Promise<void> {
    const { sessions } = this.t;
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async countByRole(role: string): Promise<number> {
    const { users } = this.t;
    const rows = await this.db.select({ count: count() }).from(users).where(eq(users.role, role));
    return rows[0]?.count ?? 0;
  }

  async setNotificationPreferences(
    id: string,
    preferences: NotificationPreferences,
  ): Promise<UserRow> {
    const { users } = this.t;
    const [row] = await this.db
      .update(users)
      .set({ notificationPreferences: preferences, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('user.notFound', { id });
    return row;
  }

  /** The stored password hash, or `null`. */
  async findPasswordHash(userId: string): Promise<string | null> {
    const { accounts } = this.t;
    const rows = await this.db
      .select({ password: accounts.password })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          eq(accounts.providerId, CREDENTIAL_PROVIDER),
          eq(accounts.issuer, CREDENTIAL_ISSUER),
        ),
      )
      .limit(1);
    return rows[0]?.password ?? null;
  }

  async setRole(id: string, role: string): Promise<UserRow> {
    const { users } = this.t;
    const [row] = await this.db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('user.notFound', { id });
    return row;
  }

  // --- space membership -----------------------------------------------------

  /** Role, memberships and custom-role grants in one query, read per request. */
  async findPrincipal(userId: string): Promise<{
    role: string;
    banned: boolean;
    twoFactorEnabled: boolean;
    spaces: Record<string, SpaceRole>;
    permissions: Record<string, string[]>;
  } | null> {
    const { memberships, roles, users } = this.t;
    const rows = await this.db
      .select({
        role: users.role,
        banned: users.banned,
        twoFactorEnabled: users.twoFactorEnabled,
        spaceId: memberships.spaceId,
        spaceRole: memberships.role,
        grants: roles.permissions,
      })
      .from(users)
      .leftJoin(memberships, eq(memberships.userId, users.id))
      .leftJoin(
        roles,
        and(eq(roles.spaceId, memberships.spaceId), eq(roles.machineName, memberships.role)),
      )
      .where(eq(users.id, userId));

    const first = rows[0];
    if (!first) return null;

    const spaces: Record<string, SpaceRole> = {};
    const permissions: Record<string, string[]> = {};
    for (const row of rows) {
      if (!row.spaceId || !row.spaceRole) continue;
      spaces[row.spaceId] = row.spaceRole;
      if (row.grants) permissions[row.spaceId] = row.grants;
    }

    return {
      role: first.role,
      banned: first.banned,
      twoFactorEnabled: first.twoFactorEnabled,
      spaces,
      permissions,
    };
  }

  async listMemberships(userId: string): Promise<MembershipRow[]> {
    const { memberships } = this.t;
    return this.db.select().from(memberships).where(eq(memberships.userId, userId));
  }

  /** The user's memberships with their spaces. */
  async listMembershipsWithSpaces(
    userId: string,
  ): Promise<Array<MembershipRow & { space: SpaceRow }>> {
    const { memberships, spaces } = this.t;
    const rows = await this.db
      .select({ membership: memberships, space: spaces })
      .from(memberships)
      .innerJoin(spaces, eq(spaces.id, memberships.spaceId))
      .where(eq(memberships.userId, userId))
      .orderBy(spaces.name);
    return rows.map((row) => ({ ...row.membership, space: row.space }));
  }

  async listMembersBySpace(spaceId: string): Promise<Array<MembershipRow & { user: UserRow }>> {
    const { memberships, users } = this.t;
    const rows = await this.db
      .select({ membership: memberships, user: users })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.spaceId, spaceId));
    return rows.map((row) => ({ ...row.membership, user: row.user }));
  }

  async findSpaceRole(userId: string, spaceId: string): Promise<SpaceRole | null> {
    const { memberships } = this.t;
    const rows = await this.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.spaceId, spaceId)))
      .limit(1);
    return rows[0]?.role ?? null;
  }

  async grant(userId: string, spaceId: string, role: SpaceRole): Promise<void> {
    const { memberships } = this.t;
    await this.db
      .insert(memberships)
      .values({ userId, spaceId, role })
      .onConflictDoUpdate({ target: [memberships.userId, memberships.spaceId], set: { role } });
  }

  async revoke(userId: string, spaceId: string): Promise<void> {
    const { memberships } = this.t;
    await this.db
      .delete(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.spaceId, spaceId)));
  }
}
