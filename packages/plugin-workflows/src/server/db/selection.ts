import type { Scope } from '@manablox/core';
import { type ContentRow, Repository } from '@manablox/db';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { WorkflowSelection } from '../../sdk/workflow.js';

/** Documents one scheduled run walks. */
export const WORKFLOW_SELECTION_LIMIT = 500;

/** The documents a scheduled workflow looks at. */
export class WorkflowSelectionRepository extends Repository {
  /** Drafts matching a selection, most recently changed first. */
  listBySelection(
    scope: Scope,
    selection: WorkflowSelection,
    limit = WORKFLOW_SELECTION_LIMIT,
  ): Promise<ContentRow[]> {
    const { contents } = this.core;
    const predicates = [this.inEnvironment(contents, scope)];
    if (selection.typeIds.length) predicates.push(inArray(contents.typeId, selection.typeIds));
    if (selection.status !== 'any') predicates.push(eq(contents.status, selection.status));
    if (selection.locale) predicates.push(eq(contents.locale, selection.locale));
    if (selection.changedWithinHours) {
      const since = new Date(Date.now() - selection.changedWithinHours * 3_600_000);
      predicates.push(gte(contents.updatedAt, since));
    }
    return this.db
      .select()
      .from(contents)
      .where(and(...predicates))
      .orderBy(desc(contents.updatedAt))
      .limit(limit);
  }
}
