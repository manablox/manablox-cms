import {
  CONTENT_EVENT_ALIASES,
  CONTENT_EVENTS,
  type ContentEvent,
  type ContentRecord,
} from '@manablox/core';
import {
  nodesOf,
  type WorkflowAbortContext,
  type WorkflowAbortEvent,
  type WorkflowAbortTrigger,
  type WorkflowEventTrigger,
} from '../../sdk.js';
import type { WorkflowRow, WorkflowRunRow } from '../db/index.js';
import { render } from '../template.js';

export function matchesEvent(
  trigger: WorkflowRow['trigger'],
  event: ContentEvent,
  row: Pick<ContentRecord, 'typeId' | 'locale'>,
): trigger is WorkflowEventTrigger {
  if (trigger.kind !== 'event') return false;
  const satisfied = CONTENT_EVENT_ALIASES[event];
  if (!trigger.events.some((wanted) => satisfied.includes(wanted))) return false;
  if (trigger.typeIds.length && !trigger.typeIds.includes(row.typeId)) return false;
  if (trigger.locales.length && !trigger.locales.includes(row.locale)) return false;
  return true;
}

/** Whether an abort trigger listens for this event; `row` narrows content events by type and locale. */
export function abortMatchesEvent(
  trigger: WorkflowAbortTrigger,
  event: WorkflowAbortEvent,
  row: Pick<ContentRecord, 'typeId' | 'locale'> | null,
): boolean {
  if (trigger.kind !== 'event') return false;
  const isContent = (CONTENT_EVENTS as readonly string[]).includes(event);
  const satisfied: readonly WorkflowAbortEvent[] = isContent
    ? CONTENT_EVENT_ALIASES[event as ContentEvent]
    : [event];
  if (!trigger.events.some((wanted) => satisfied.includes(wanted))) return false;
  if (row && trigger.typeIds.length && !trigger.typeIds.includes(row.typeId)) return false;
  if (row && trigger.locales.length && !trigger.locales.includes(row.locale)) return false;
  return true;
}

/** Whether a trigger's match picks this run out of the workflow's active ones. */
export function abortSelects(
  trigger: WorkflowAbortTrigger,
  run: Pick<WorkflowRunRow, 'context' | 'state'>,
  context: WorkflowAbortContext,
): boolean {
  const { mode, runKey, abortKey } = trigger.match;
  if (mode === 'all') return true;
  if (mode === 'document') {
    const id = (run.context.content as { id?: unknown } | null)?.id;
    return id !== undefined && id !== null && id === context.content?.id;
  }
  const ours = render(runKey, { ...run.context, nodes: nodesOf(run.state) }).trim();
  const theirs = render(abortKey, context).trim();
  return ours !== '' && ours === theirs;
}
