import { z } from 'zod';
import { scoped } from '../base.js';
import { allowedTypeIdsIn, assertOnDocument, toActor } from '../guards.js';
import { pagination, spaceItem, spaceScoped } from '../schemas.js';

/** The dashboard reads the review queue a screenful at a time. */
const approvalPagination = pagination({ limit: 10, max: 100 });

/** The author's or reviewer's note. */
const note = z.string().max(2000);

/** Review procedures, mounted flat on the content router. */
export const contentApprovalRouter = {
  /** A document's review state: open request, last decision, history. */
  approval: scoped('content:read')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:read', input.id);
      return context.approvals.state(context.env, input.id);
    }),

  /** Open requests for types the caller can publish. */
  pendingApprovals: scoped('content:publish')
    .input(spaceScoped.extend({ pagination: approvalPagination }))
    .handler(async ({ input, context }) =>
      context.approvals.pending(
        context.env,
        allowedTypeIdsIn(context, input.spaceId, 'content:publish'),
        input.pagination,
      ),
    ),

  requestApproval: scoped('content:write')
    .input(spaceItem.extend({ note: note.optional() }))
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:write', input.id);
      return context.approvals.request(
        context.env,
        input.id,
        toActor(context, input.spaceId),
        input.note?.trim() || null,
      );
    }),

  withdrawApproval: scoped('content:write')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:write', input.id);
      return context.approvals.withdraw(context.env, input.id, toActor(context, input.spaceId));
    }),

  /** Approves and publishes; the requester is told. */
  approve: scoped('content:publish')
    .input(spaceItem.extend({ note: note.optional() }))
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:publish', input.id);
      return context.approvals.approve(
        context.env,
        input.id,
        toActor(context, input.spaceId),
        input.note?.trim() || null,
      );
    }),

  /** Sends the document back with a note; the requester is told. */
  reject: scoped('content:publish')
    .input(spaceItem.extend({ note: note.optional() }))
    .handler(async ({ input, context }) => {
      await assertOnDocument(context, input.spaceId, 'content:publish', input.id);
      return context.approvals.reject(
        context.env,
        input.id,
        toActor(context, input.spaceId),
        input.note?.trim() || null,
      );
    }),
};
