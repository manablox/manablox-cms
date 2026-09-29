import {
  type ContentTypeDefinition,
  ManabloxError,
  type Scope,
  scopeOf,
  scopeSpaceId,
} from '@manablox/core';
import { currentActor, type Manablox } from '@manablox/core/node';
import {
  type ContentApprovalRow,
  type ContentRow,
  type Paginated,
  type Pagination,
  type PendingApproval,
  type Repositories,
  rootRepositories,
  whenCommitted,
} from '@manablox/db';
import { onWrite } from './content/listeners.js';
import type { ContentService } from './content/service.js';
import type { Actor } from './content/types.js';
import { contentAuditor, requireInSpace, resolveScope } from './lib.js';
import type { NotificationService } from './notification.service.js';
import { usersHolding } from './recipients.js';

export type { ContentApprovalRow, PendingApproval };

/** A document's approval state as the editor shows it. */
export interface ApprovalState {
  /** Whether the type requires review. */
  required: boolean;
  pending: ContentApprovalRow | null;
  /** The latest request, pending or decided. */
  latest: ContentApprovalRow | null;
  history: ContentApprovalRow[];
}

/** Review requests for `requiresApproval` types; publish permission still comes from roles. */
export class ApprovalService {
  private readonly audit;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    private readonly content: ContentService,
    private readonly notifications: NotificationService,
  ) {
    this.audit = contentAuditor(repos);
  }

  async state(scope: Scope, contentId: string): Promise<ApprovalState> {
    const spaceId = scopeSpaceId(scope);
    const row = await this.requireContent(scope, contentId);
    const type = this.manablox.contentTypes.get(row.typeId);
    const history = await this.repos.approvals.listByContent(contentId);
    return {
      required: type.requiresApproval && (await this.approvalsOn(spaceId)),
      pending: history.find((entry) => entry.status === 'pending') ?? null,
      latest: history[0] ?? null,
      history,
    };
  }

  /** Paged open requests for the types the reviewer can publish. */
  pending(
    scope: Scope,
    typeIds: string[] | null = null,
    pagination: Pagination = { limit: 10, offset: 0 },
  ): Promise<Paginated<PendingApproval>> {
    return this.repos.approvals.pagePendingBySpace(scope, typeIds, pagination);
  }

  /** Opens a request and notifies the publishers; one open request per document. */
  async request(
    scope: Scope,
    contentId: string,
    actor: Actor | null,
    note: string | null = null,
  ): Promise<ContentApprovalRow> {
    const spaceId = scopeSpaceId(scope);
    const row = await this.requireContent(scope, contentId);
    const type = this.assertReviewable(row);
    await this.manablox.controls.assertFeature(spaceId, 'approvals');
    if (await this.repos.approvals.findPendingByContent(contentId)) {
      throw ManabloxError.conflict('content.approval.alreadyPending', { id: contentId });
    }
    const who = currentActor();
    const approval = await this.repos.transaction(async (tx) => {
      const approval = await tx.approvals.request({
        spaceId,
        contentId,
        typeId: row.typeId,
        requestedBy: actor?.userId ?? null,
        requestedByLabel: who.label,
        requestNote: note,
        contentVersion: row.version,
      });
      await this.audit
        .in(tx)
        .record('content.requestApproval', row, [], approvalMeta(approval, note));
      return approval;
    });

    const reviewers = await this.reviewers(spaceId, row.typeId);
    await this.notifications.notify({
      kind: 'content.approvalRequested',
      recipients: reviewers.map((user) => user.id),
      spaceId,
      title: `"${row.title || 'Untitled'}" is waiting for your approval`,
      body: note
        ? `${who.label} asked for this ${type.label} to be published: ${note}`
        : `${who.label} asked for this ${type.label} to be published.`,
      url: await this.contentUrl(row),
      targetKind: 'content',
      targetId: row.id,
      meta: { approvalId: approval.id, typeId: row.typeId },
    });
    return approval;
  }

  /** Withdrawn by the author only. */
  async withdraw(
    scope: Scope,
    contentId: string,
    actor: Actor | null,
  ): Promise<ContentApprovalRow> {
    const spaceId = scopeSpaceId(scope);
    const row = await this.requireContent(scope, contentId);
    const pending = await this.requirePending(contentId);
    if (!actor || pending.requestedBy !== actor.userId) {
      throw ManabloxError.forbidden('content.approval.notRequester', { id: contentId });
    }
    const who = currentActor();
    const approval = await this.repos.transaction(async (tx) => {
      const approval = await tx.approvals.decide(pending.id, {
        status: 'withdrawn',
        decidedBy: actor.userId,
        decidedByLabel: who.label,
      });
      await this.audit
        .in(tx)
        .record('content.withdrawApproval', row, [], approvalMeta(approval, null));
      return approval;
    });

    const reviewers = await this.reviewers(spaceId, row.typeId);
    await this.notifications.notify({
      kind: 'content.approvalWithdrawn',
      recipients: reviewers.map((user) => user.id),
      spaceId,
      title: `"${row.title || 'Untitled'}" no longer needs your approval`,
      body: `${who.label} withdrew the request.`,
      url: await this.contentUrl(row),
      targetKind: 'content',
      targetId: row.id,
      meta: { approvalId: approval.id, typeId: row.typeId },
    });
    return approval;
  }

  /**
   * Approves and publishes in one transaction; closed first so the `content:afterPublish`
   * listener skips it.
   */
  async approve(
    scope: Scope,
    contentId: string,
    actor: Actor | null,
    note: string | null = null,
  ): Promise<{ approval: ContentApprovalRow; content: ContentRow }> {
    await this.requireContent(scope, contentId);
    const pending = await this.requirePending(contentId);
    const who = currentActor();
    const { approval, published } = await this.repos.transaction(async (tx) => {
      const approval = await tx.approvals.decide(pending.id, {
        status: 'approved',
        decidedBy: actor?.userId ?? null,
        decidedByLabel: who.label,
        decisionNote: note,
      });
      const published = await this.content.using(tx).publish(scope, contentId, actor);
      await this.audit
        .in(tx)
        .record('content.approve', published, [], approvalMeta(approval, note));
      return { approval, published };
    });
    await this.tellRequester(approval, published, 'content.approved', {
      title: `"${published.title || 'Untitled'}" was approved and published`,
      body: note ? `${who.label} approved it: ${note}` : `${who.label} approved and published it.`,
    });
    return { approval, content: published };
  }

  /** Sends the document back with a note. */
  async reject(
    scope: Scope,
    contentId: string,
    actor: Actor | null,
    note: string | null = null,
  ): Promise<ContentApprovalRow> {
    const row = await this.requireContent(scope, contentId);
    const pending = await this.requirePending(contentId);
    const who = currentActor();
    const approval = await this.repos.transaction(async (tx) => {
      const approval = await tx.approvals.decide(pending.id, {
        status: 'rejected',
        decidedBy: actor?.userId ?? null,
        decidedByLabel: who.label,
        decisionNote: note,
      });
      await this.audit.in(tx).record('content.reject', row, [], approvalMeta(approval, note));
      return approval;
    });
    await this.tellRequester(approval, row, 'content.rejected', {
      title: `"${row.title || 'Untitled'}" was sent back`,
      body: note
        ? `${who.label} sent it back: ${note}`
        : `${who.label} sent it back without a note.`,
    });
    return approval;
  }

  /** Any publish closes the document's open request as approved, in the publish's transaction. */
  attach(): void {
    onWrite(this.manablox, 'content:afterPublish', async (record, context, repos) => {
      const pending = await repos.approvals.findPendingByContent(record.id);
      if (!pending) return;
      const who = currentActor();
      const approval = await repos.approvals.decide(pending.id, {
        status: 'approved',
        decidedBy: context.actor?.userId ?? null,
        decidedByLabel: who.label,
      });
      await whenCommitted(repos, () =>
        this.tellRequester(approval, record as ContentRow, 'content.approved', {
          title: `"${record.title || 'Untitled'}" was published`,
          body: `${who.label} published it.`,
        }),
      );
    });
  }

  // -------------------------------------------------------------------------

  private async tellRequester(
    approval: ContentApprovalRow,
    row: ContentRow,
    kind: 'content.approved' | 'content.rejected',
    message: { title: string; body: string },
  ): Promise<void> {
    if (!approval.requestedBy) return;
    await this.notifications.notify({
      kind,
      recipients: [approval.requestedBy],
      spaceId: row.spaceId,
      ...message,
      url: await this.contentUrl(row),
      targetKind: 'content',
      targetId: row.id,
      meta: { approvalId: approval.id, typeId: row.typeId },
    });
  }

  /** The admin path of a document; a staging one carries its environment. */
  /** Who may publish documents of the type; a staging type counts by its production grant. */
  private reviewers(spaceId: string, typeId: string) {
    const grantType = this.manablox.contentTypes.grantTypeId(typeId);
    return usersHolding(this.repos, spaceId, 'content:publish', grantType);
  }

  private async contentUrl(row: ContentRow): Promise<string> {
    const scope = await resolveScope(rootRepositories(this.repos), scopeOf(row));
    return typeof scope === 'string' || scope.production
      ? `/content/${row.id}`
      : `/content/${row.id}?env=${scope.machineName}`;
  }

  private async requireContent(scope: Scope, contentId: string): Promise<ContentRow> {
    return requireInSpace(await this.repos.content.findById(contentId), scope, 'content.notFound', {
      id: contentId,
    });
  }

  private async requirePending(contentId: string): Promise<ContentApprovalRow> {
    const pending = await this.repos.approvals.findPendingByContent(contentId);
    if (!pending) throw ManabloxError.badRequest('content.approval.notPending', { id: contentId });
    return pending;
  }

  /** Off, `requiresApproval` is ignored; open requests can still be decided. */
  private async approvalsOn(spaceId: string): Promise<boolean> {
    return (await this.manablox.controls.feature(spaceId, 'approvals')).enabled;
  }

  private assertReviewable(row: ContentRow): ContentTypeDefinition {
    const type = this.manablox.contentTypes.get(row.typeId);
    if (!type.requiresApproval || !type.isPublishable) {
      throw ManabloxError.badRequest('content.approval.notRequired', { type: type.name });
    }
    return type;
  }
}

/** An approval entry's meta; the note only when given. */
function approvalMeta(approval: ContentApprovalRow, note: string | null): Record<string, unknown> {
  return { approvalId: approval.id, status: approval.status, ...(note ? { note } : {}) };
}
