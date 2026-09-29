import { type ApprovalStatus, ManabloxError, type Scope } from '@manablox/core';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { APPROVAL_HISTORY_LIMIT, countOver, type Paginated } from '../pagination.js';
import type { Pagination } from '../query.js';
import type { ContentApprovalRow } from '../schema/index.js';
import { Repository } from './base.js';

export interface ApprovalRequestData {
  spaceId: string;
  contentId: string;
  typeId: string;
  requestedBy: string | null;
  requestedByLabel: string;
  requestNote?: string | null | undefined;
  contentVersion?: number | null | undefined;
}

export interface ApprovalDecisionData {
  status: Exclude<ApprovalStatus, 'pending'>;
  decidedBy: string | null;
  decidedByLabel: string | null;
  decisionNote?: string | null | undefined;
}

/** A pending request with its document. */
export interface PendingApproval extends ContentApprovalRow {
  content: { id: string; title: string; locale: string; typeId: string; updatedAt: Date };
}

/** Approval requests; the service enforces one pending per document. */
export class ContentApprovalRepository extends Repository {
  findById(id: string): Promise<ContentApprovalRow | null> {
    return this.findOne(this.t.contentApprovals, id);
  }

  /** The open request on a document. */
  async findPendingByContent(contentId: string): Promise<ContentApprovalRow | null> {
    const { contentApprovals } = this.t;
    return this.findOneWhere(
      contentApprovals,
      and(eq(contentApprovals.contentId, contentId), eq(contentApprovals.status, 'pending')),
      desc(contentApprovals.requestedAt),
    );
  }

  /** The most recent request on a document. */
  async findLatestByContent(contentId: string): Promise<ContentApprovalRow | null> {
    const { contentApprovals } = this.t;
    return this.findOneWhere(
      contentApprovals,
      eq(contentApprovals.contentId, contentId),
      desc(contentApprovals.requestedAt),
    );
  }

  listByContent(contentId: string, limit = APPROVAL_HISTORY_LIMIT): Promise<ContentApprovalRow[]> {
    const { contentApprovals } = this.t;
    return this.db
      .select()
      .from(contentApprovals)
      .where(eq(contentApprovals.contentId, contentId))
      .orderBy(desc(contentApprovals.requestedAt))
      .limit(limit);
  }

  /** One page of open requests in a space, oldest first; `typeIds` narrows by type. */
  async pagePendingBySpace(
    scope: Scope,
    typeIds: string[] | null = null,
    pagination: Pagination = { limit: 10, offset: 0 },
  ): Promise<Paginated<PendingApproval>> {
    const { contentApprovals, contents } = this.t;
    const empty = { items: [], total: 0, ...pagination };
    if (typeIds && typeIds.length === 0) return empty;
    const conditions = [
      this.inEnvironment(contentApprovals, scope),
      eq(contentApprovals.status, 'pending'),
    ];
    if (typeIds) conditions.push(inArray(contentApprovals.typeId, typeIds));
    const where = and(...conditions);
    const rows = await this.db
      .select({
        approval: contentApprovals,
        content: {
          id: contents.id,
          title: contents.title,
          locale: contents.locale,
          typeId: contents.typeId,
          updatedAt: contents.updatedAt,
        },
        total: countOver(),
      })
      .from(contentApprovals)
      .innerJoin(contents, eq(contents.id, contentApprovals.contentId))
      .where(where)
      .orderBy(contentApprovals.requestedAt, contentApprovals.id)
      .limit(pagination.limit)
      .offset(pagination.offset);

    let total = rows[0]?.total ?? 0;
    if (rows.length === 0 && pagination.offset > 0) {
      const counted = await this.db
        .select({ count: count() })
        .from(contentApprovals)
        .innerJoin(contents, eq(contents.id, contentApprovals.contentId))
        .where(where);
      total = counted[0]?.count ?? 0;
    }

    return {
      items: rows.map((row) => ({ ...row.approval, content: row.content })),
      total,
      ...pagination,
    };
  }

  /** In the document's environment. */
  async request(data: ApprovalRequestData): Promise<ContentApprovalRow> {
    const { contentApprovals, contents } = this.t;
    const [row] = await this.db
      .insert(contentApprovals)
      .values({
        spaceId: data.spaceId,
        environmentId: sql`(select ${contents.environmentId} from ${contents} where ${contents.id} = ${data.contentId})`,
        contentId: data.contentId,
        typeId: data.typeId,
        requestedBy: data.requestedBy,
        requestedByLabel: data.requestedByLabel,
        requestNote: data.requestNote ?? null,
        contentVersion: data.contentVersion ?? null,
      })
      .returning();
    if (!row) throw new ManabloxError('content.approval.create.failed');
    return row;
  }

  async decide(id: string, data: ApprovalDecisionData): Promise<ContentApprovalRow> {
    const { contentApprovals } = this.t;
    const [row] = await this.db
      .update(contentApprovals)
      .set({
        status: data.status,
        decidedBy: data.decidedBy,
        decidedByLabel: data.decidedByLabel,
        decisionNote: data.decisionNote ?? null,
        decidedAt: new Date(),
      })
      .where(eq(contentApprovals.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('content.approval.notPending', { id });
    return row;
  }
}
