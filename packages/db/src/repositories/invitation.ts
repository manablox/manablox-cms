import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { InvitationGrant } from '../definitions/auth.js';
import type { InvitationRow } from '../schema/index.js';
import { Repository } from './base.js';

export type { InvitationGrant } from '../definitions/auth.js';

export interface InvitationCreateData {
  email: string;
  tokenHash: string;
  grants: InvitationGrant[];
  invitedBy: string | null;
  expiresAt: Date;
}

/** Invitations by email; tokens are stored as hashes only. */
export class InvitationRepository extends Repository {
  async create(data: InvitationCreateData): Promise<InvitationRow> {
    const [row] = await this.db.insert(this.t.invitations).values(data).returning();
    return row as InvitationRow;
  }

  findById(id: string): Promise<InvitationRow | null> {
    return this.findOne(this.t.invitations, id);
  }

  findByTokenHash(tokenHash: string): Promise<InvitationRow | null> {
    const { invitations } = this.t;
    return this.findOneWhere(invitations, eq(invitations.tokenHash, tokenHash));
  }

  /** Newest first; with `spaceId`, those granting a role in that space. */
  async list(options: { spaceId?: string | undefined; limit: number }): Promise<InvitationRow[]> {
    const { invitations } = this.t;
    const rows = await this.db
      .select()
      .from(invitations)
      .orderBy(desc(invitations.createdAt), desc(invitations.id));
    const matching = options.spaceId
      ? rows.filter((row) => row.grants.some((grant) => grant.spaceId === options.spaceId))
      : rows;
    return matching.slice(0, options.limit);
  }

  /** A new token and expiry for an open invitation; `null` once accepted or revoked. */
  async renew(id: string, tokenHash: string, expiresAt: Date): Promise<InvitationRow | null> {
    const { invitations } = this.t;
    const [row] = await this.db
      .update(invitations)
      .set({ tokenHash, expiresAt })
      .where(and(eq(invitations.id, id), this.open()))
      .returning();
    return row ?? null;
  }

  /** `null` when it was accepted or revoked already. */
  async revoke(id: string, at = new Date()): Promise<InvitationRow | null> {
    const { invitations } = this.t;
    const [row] = await this.db
      .update(invitations)
      .set({ revokedAt: at })
      .where(and(eq(invitations.id, id), this.open()))
      .returning();
    return row ?? null;
  }

  /** Marks it accepted once; `null` when it expired or was accepted or revoked meanwhile. */
  async claim(id: string, userId: string, at = new Date()): Promise<InvitationRow | null> {
    const { invitations } = this.t;
    const [row] = await this.db
      .update(invitations)
      .set({ acceptedAt: at, acceptedBy: userId })
      .where(and(eq(invitations.id, id), this.open(), gt(invitations.expiresAt, at)))
      .returning();
    return row ?? null;
  }

  private open() {
    const { invitations } = this.t;
    return and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));
  }
}
