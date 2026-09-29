import { createHash, randomBytes } from 'node:crypto';
import {
  type AuditActor,
  auditor,
  DAY_MS,
  isBuiltInRole,
  type LimitIncrement,
  ManabloxError,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type {
  InvitationGrant,
  InvitationRow,
  Repositories,
  TransactionRepositories,
} from '@manablox/db';
import type { AuthMailSender } from './mail-sender.js';
import { can, type Principal } from './rbac.js';
import type { UserService } from './user.service.js';

/** Admin route that takes `?token=`. */
export const ACCEPT_INVITE_PATH = '/accept-invite';
/** Default lifetime of an invitation. */
export const INVITATION_DAYS = 7;

/** Grants memberships; `SpaceService` from `@manablox/services`. */
export interface InvitationSpaces {
  using(repos: Repositories): InvitationSpaces;
  addMembers(
    spaceId: string,
    userIds: string[],
    role: string,
    options?: { mail?: boolean },
  ): Promise<number>;
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface InvitationView {
  id: string;
  email: string;
  grants: Array<InvitationGrant & { spaceName: string | null }>;
  invitedBy: { id: string; name: string; email: string } | null;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** What the accept page shows before anyone signs in. */
export interface InvitationPreview {
  email: string;
  inviter: string | null;
  spaces: Array<{ id: string; name: string; role: string }>;
  expiresAt: Date;
  /** Sign in with it to accept; otherwise a new account is set up. */
  accountExists: boolean;
}

export interface InvitationIssued {
  invitation: InvitationView;
  /** The accept link when no mail carried it; shown once. */
  link: string | null;
}

export interface CreateInvitationInput {
  email: string;
  grants: InvitationGrant[];
  /** Days until it expires; `INVITATION_DAYS` by default. */
  expiresInDays?: number | undefined;
}

/** A new account's details, or `null` to attach the grants to the signed-in account. */
export type AcceptInput = { name: string; password: string } | null;

/**
 * Invitations by email with space grants. Superadmins invite with or without grants; space
 * admins (`user:write`) only into their spaces. Only a hash of each token is stored; the seat
 * limits are checked when inviting and enforced when accepting.
 */
export class InvitationService {
  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    private readonly deps: { users: UserService; spaces: InvitationSpaces; sender: AuthMailSender },
  ) {}

  /** Whether invitations go out by mail; without, the link is returned. */
  get mailEnabled(): boolean {
    return this.deps.sender.enabled;
  }

  async create(principal: Principal, input: CreateInvitationInput): Promise<InvitationIssued> {
    const email = input.email.trim().toLowerCase();
    const grants = await this.checkGrants(principal, input.grants);
    await this.precheckSeats(email, grants);
    if (this.mailEnabled && !(await this.deps.sender.allow(`invite:${email}`))) {
      throw ManabloxError.rateLimited('auth.mails.tooMany', { email });
    }
    const token = newToken();
    const days = input.expiresInDays ?? INVITATION_DAYS;
    const row = await this.repos.invitations.create({
      email,
      tokenHash: hashInvitationToken(token),
      grants,
      invitedBy: principal.viaApiKey ? null : principal.userId,
      expiresAt: new Date(Date.now() + days * DAY_MS),
    });
    await this.audit().record('invitation.create', row, undefined, { grants });
    return this.deliver(row, token, principal);
  }

  /** Newest first; with `spaceId`, only those granting a role in that space. */
  async list(options: { spaceId?: string | undefined } = {}): Promise<InvitationView[]> {
    const rows = await this.repos.invitations.list({ spaceId: options.spaceId, limit: 200 });
    return this.views(rows);
  }

  /** The invitation, if the principal may manage it. */
  async get(principal: Principal, id: string): Promise<InvitationView> {
    const row = await this.requireManaged(principal, id);
    return (await this.views([row]))[0] as InvitationView;
  }

  async revoke(principal: Principal, id: string): Promise<InvitationView> {
    await this.requireManaged(principal, id);
    const row = await this.repos.invitations.revoke(id);
    if (!row) throw ManabloxError.badRequest('invitation.invalid', { id });
    await this.audit().record('invitation.revoke', row);
    return (await this.views([row]))[0] as InvitationView;
  }

  /** A new link with a fresh expiry; the old link stops working. */
  async resend(principal: Principal, id: string): Promise<InvitationIssued> {
    const current = await this.requireManaged(principal, id);
    if (this.mailEnabled && !(await this.deps.sender.allow(`invite:${current.email}`))) {
      throw ManabloxError.rateLimited('auth.mails.tooMany', { email: current.email });
    }
    const token = newToken();
    const days = Math.max(
      1,
      Math.round((current.expiresAt.getTime() - current.createdAt.getTime()) / DAY_MS),
    );
    const row = await this.repos.invitations.renew(
      id,
      hashInvitationToken(token),
      new Date(Date.now() + days * DAY_MS),
    );
    if (!row) throw ManabloxError.badRequest('invitation.invalid', { id });
    await this.audit().record('invitation.resend', row);
    return this.deliver(row, token, principal);
  }

  /** What the link grants; refused once it is used, revoked or expired. */
  async preview(token: string): Promise<InvitationPreview> {
    const row = await this.open(token);
    const [view] = await this.views([row]);
    return {
      email: row.email,
      inviter: view?.invitedBy ? view.invitedBy.name || view.invitedBy.email : null,
      spaces: (view?.grants ?? []).flatMap((grant) =>
        grant.spaceName ? [{ id: grant.spaceId, name: grant.spaceName, role: grant.role }] : [],
      ),
      expiresAt: row.expiresAt,
      accountExists: (await this.repos.users.findByEmail(row.email)) !== null,
    };
  }

  /**
   * Redeems a link: a new account with a confirmed address, or the grants for the signed-in
   * account of the invited address. Spaces or roles removed meanwhile are skipped.
   */
  async accept(
    token: string,
    input: AcceptInput,
    principal: Principal | null,
  ): Promise<{ userId: string; email: string; created: boolean }> {
    const row = await this.open(token);
    const existing = await this.repos.users.findByEmail(row.email);
    if (existing) {
      if (!principal || principal.viaApiKey) {
        throw ManabloxError.badRequest('invitation.signInRequired', { email: row.email });
      }
      if (principal.userId !== existing.id) {
        throw ManabloxError.forbidden('invitation.emailMismatch', { email: row.email });
      }
    } else if (!input) {
      throw ManabloxError.badRequest('invitation.signInRequired', { email: row.email });
    }
    const grants = await this.liveGrants(row.grants);

    const userId = await this.repos.transaction(async (tx) => {
      const account = existing
        ? existing
        : await this.deps.users.using(tx).create({
            name: input?.name ?? '',
            email: row.email,
            password: input?.password ?? '',
            role: 'editor',
            emailVerified: true,
          });
      const claimed = await tx.invitations.claim(row.id, account.id);
      if (!claimed) throw ManabloxError.badRequest('invitation.invalid');
      for (const grant of grants) {
        await this.deps.spaces
          .using(tx)
          .addMembers(grant.spaceId, [account.id], grant.role, { mail: false });
      }
      const actor: AuditActor = { kind: 'user', id: account.id, label: account.email };
      await this.audit(actor, tx).record('invitation.accept', claimed, undefined, {
        grants,
        created: !existing,
      });
      return account.id;
    });
    return { userId, email: row.email, created: !existing };
  }

  private async deliver(
    row: InvitationRow,
    token: string,
    principal: Principal,
  ): Promise<InvitationIssued> {
    const [view] = await this.views([row]);
    const invitation = view as InvitationView;
    const url = this.deps.sender.link(ACCEPT_INVITE_PATH, token);
    if (!this.mailEnabled) return { invitation, link: url };
    const inviter = invitation.invitedBy?.name || invitation.invitedBy?.email || principal.email;
    await this.deps.sender.send(row.email, {
      kind: 'invite',
      inviter,
      spaces: invitation.grants.flatMap((grant) => (grant.spaceName ? [grant.spaceName] : [])),
      url,
      expiresAt: row.expiresAt,
    });
    return { invitation, link: null };
  }

  /** Unique spaces that exist, roles that exist there, each a space the principal manages. */
  private async checkGrants(
    principal: Principal,
    grants: readonly InvitationGrant[],
  ): Promise<InvitationGrant[]> {
    const superadmin = principal.role === 'superadmin' && !principal.allowedSpaceIds;
    if (!superadmin && grants.length === 0) {
      throw ManabloxError.validation(
        [{ key: 'invitation.grants.required', path: ['grants'] }],
        'validation.failed',
      );
    }
    const seen = new Set<string>();
    for (const [index, grant] of grants.entries()) {
      if (seen.has(grant.spaceId)) {
        throw ManabloxError.validation(
          [{ key: 'invitation.grant.duplicate', path: ['grants', index, 'spaceId'] }],
          'validation.failed',
        );
      }
      seen.add(grant.spaceId);
      if (!can(principal, grant.spaceId, 'user:write')) {
        throw ManabloxError.forbidden('auth.forbidden', {
          permission: 'user:write',
          spaceId: grant.spaceId,
        });
      }
      if (!(await this.repos.spaces.findById(grant.spaceId))) {
        throw ManabloxError.validation(
          [{ key: 'invitation.space.notFound', path: ['grants', index, 'spaceId'] }],
          'validation.failed',
        );
      }
      if (!(await this.roleExists(grant.spaceId, grant.role))) {
        throw ManabloxError.validation(
          [{ key: 'invitation.role.unknown', path: ['grants', index, 'role'] }],
          'validation.failed',
        );
      }
      if (!isBuiltInRole(grant.role)) {
        await this.manablox.controls.assertFeature(grant.spaceId, 'customRoles');
      }
    }
    return grants.map((grant) => ({ spaceId: grant.spaceId, role: grant.role }));
  }

  /** Refuses an invitation that could not be accepted today; nothing is reserved. */
  private async precheckSeats(email: string, grants: readonly InvitationGrant[]): Promise<void> {
    const existing = await this.repos.users.findByEmail(email);
    const { controls } = this.manablox;
    if (!existing) await controls.assertLimit(null, 'seats');
    for (const grant of grants) {
      if (existing && (await this.repos.users.findSpaceRole(existing.id, grant.spaceId))) continue;
      await controls.assertLimit(grant.spaceId, 'seats', {
        increment: this.seatIncrement(existing?.id ?? null),
      });
    }
  }

  /** One seat at a space; at a group, none when the account is in one of its spaces already. */
  private seatIncrement(userId: string | null): LimitIncrement {
    return async (target) => {
      if (target.scope.kind === 'instance') return 0;
      if (target.scope.kind === 'space' || !userId) return 1;
      return this.repos.limitCounts.usersOutside(target.spaceIds === 'all' ? [] : target.spaceIds, [
        userId,
      ]);
    };
  }

  private async liveGrants(grants: readonly InvitationGrant[]): Promise<InvitationGrant[]> {
    const live: InvitationGrant[] = [];
    for (const grant of grants) {
      if (!(await this.repos.spaces.findById(grant.spaceId))) continue;
      if (!(await this.roleExists(grant.spaceId, grant.role))) continue;
      live.push(grant);
    }
    return live;
  }

  private async roleExists(spaceId: string, role: string): Promise<boolean> {
    if (isBuiltInRole(role)) return true;
    return (await this.repos.roles.findByMachineName(spaceId, role)) !== null;
  }

  /** The pending invitation behind a token. */
  private async open(token: string): Promise<InvitationRow> {
    const row = await this.repos.invitations.findByTokenHash(hashInvitationToken(token));
    if (!row || row.acceptedAt || row.revokedAt)
      throw ManabloxError.badRequest('invitation.invalid');
    if (row.expiresAt.getTime() <= Date.now()) throw ManabloxError.badRequest('invitation.expired');
    return row;
  }

  /** Superadmins manage every invitation; space admins those whose spaces they all manage. */
  private async requireManaged(principal: Principal, id: string): Promise<InvitationRow> {
    const row = await this.repos.invitations.findById(id);
    if (!row) throw ManabloxError.notFound('invitation.notFound', { id });
    const superadmin = principal.role === 'superadmin' && !principal.allowedSpaceIds;
    const allowed =
      superadmin ||
      (row.grants.length > 0 &&
        row.grants.every((grant) => can(principal, grant.spaceId, 'user:write')));
    if (!allowed) throw ManabloxError.notFound('invitation.notFound', { id });
    return row;
  }

  private async views(rows: readonly InvitationRow[]): Promise<InvitationView[]> {
    const spaceIds = [...new Set(rows.flatMap((row) => row.grants.map((grant) => grant.spaceId)))];
    const userIds = [...new Set(rows.flatMap((row) => (row.invitedBy ? [row.invitedBy] : [])))];
    const [spaces, users] = await Promise.all([
      spaceIds.length ? this.repos.spaces.listByIds(spaceIds) : Promise.resolve([]),
      this.repos.users.listByIds(userIds),
    ]);
    const spaceName = new Map(spaces.map((space) => [space.id, space.name]));
    const userOf = new Map(users.map((user) => [user.id, user]));
    const now = Date.now();
    return rows.map((row) => {
      const inviter = row.invitedBy ? userOf.get(row.invitedBy) : undefined;
      return {
        id: row.id,
        email: row.email,
        grants: row.grants.map((grant) => ({
          ...grant,
          spaceName: spaceName.get(grant.spaceId) ?? null,
        })),
        invitedBy: inviter ? { id: inviter.id, name: inviter.name, email: inviter.email } : null,
        status: row.acceptedAt
          ? 'accepted'
          : row.revokedAt
            ? 'revoked'
            : row.expiresAt.getTime() <= now
              ? 'expired'
              : 'pending',
        expiresAt: row.expiresAt,
        acceptedAt: row.acceptedAt,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
      };
    });
  }

  private audit(actor?: AuditActor, sink: Repositories | TransactionRepositories = this.repos) {
    return auditor(sink, 'invitation', (row: InvitationRow) => row.email, {
      // A single-space invitation shows in that space's activity.
      spaceId: (row) => (row.grants.length === 1 ? (row.grants[0]?.spaceId ?? null) : null),
      ...(actor ? { actor } : {}),
    });
  }
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this is stored. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
