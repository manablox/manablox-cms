import { hasMessage, messageForKey } from '@manablox/admin-sdk';
import type {
  WorkflowActionMeta,
  WorkflowNodeLog,
  WorkflowRunAbort,
  WorkflowRunStatus,
} from '../../sdk';
import { CONTROL_NODES } from './nodes';
import { isBuiltinTriggerKind, triggerKind } from './triggers';

/** How each run status is shown. */
export const RUN_STATUS: Record<
  WorkflowRunStatus,
  { label: string; badge: string; icon: string; tone: string }
> = {
  queued: { label: 'Queued', badge: 'mb-badge', icon: 'clock', tone: 'text-surface-400' },
  running: { label: 'Running', badge: 'mb-badge-brand', icon: 'activity', tone: 'text-brand-500' },
  waiting: { label: 'Waiting', badge: 'mb-badge-warn', icon: 'hourglass', tone: 'text-warn-500' },
  succeeded: { label: 'Succeeded', badge: 'mb-badge-ok', icon: 'ok', tone: 'text-ok-500' },
  failed: { label: 'Failed', badge: 'mb-badge-danger', icon: 'fail', tone: 'text-danger-500' },
  skipped: { label: 'Stopped', badge: 'mb-badge', icon: 'ban', tone: 'text-surface-400' },
  aborted: { label: 'Aborted', badge: 'mb-badge-warn', icon: 'stop', tone: 'text-warn-500' },
};

/** Text colour per step status. */
export const STEP_TONE: Record<WorkflowNodeLog['status'], string> = {
  ok: 'wf:text-ok-700 wf:dark:text-ok-500',
  failed: 'wf:text-danger-600 wf:dark:text-danger-400',
  skipped: 'text-surface-400',
  stopped: 'wf:text-warn-700 wf:dark:text-warn-300',
  waiting: 'wf:text-warn-700 wf:dark:text-warn-300',
};

const TRIGGER_LABEL: Record<string, string> = {
  'content.created': 'Document created',
  'content.updated': 'Document updated',
  'content.saved': 'Document saved',
  'content.deleted': 'Document deleted',
  'content.published': 'Document published',
  'content.unpublished': 'Document unpublished',
  schedule: 'On schedule',
  manual: 'Run by hand',
  call: 'Run by a workflow',
};

/** What started a run, in a few words; a contributed kind's plugin names its own. */
export function triggerLabel(trigger: string, test = false): string {
  if (test && trigger === 'manual') return 'Test run';
  if (TRIGGER_LABEL[trigger]) return TRIGGER_LABEL[trigger];
  if (isBuiltinTriggerKind(trigger)) return trigger;
  const kind = triggerKind(trigger);
  return kind.entry?.runLabel ?? kind.label;
}

/** Who or what aborted a run, in a phrase. */
export function abortedBy(abort: WorkflowRunAbort | null): string {
  if (!abort) return 'Aborted';
  const contributed =
    abort.source === 'api' || abort.source === 'caller' || abort.source === 'event'
      ? undefined
      : triggerKind(abort.source).entry?.abortedBy?.(abort);
  const by =
    abort.source === 'api'
      ? `by ${abort.actor ?? 'the API'}`
      : abort.source === 'caller'
        ? 'along with the run that called it'
        : (contributed ?? `on ${abort.event ?? 'an event'}`);
  return `Aborted ${by}${abort.reason ? `: ${abort.reason}` : ''}`;
}

/** A step's icon: the action's, if installed. */
export function stepIcon(entry: WorkflowNodeLog, actions: WorkflowActionMeta[]): string {
  if (entry.kind !== 'action') return CONTROL_NODES[entry.kind]?.icon ?? 'zap';
  return actions.find((action) => action.type === entry.action)?.icon ?? 'zap';
}

export function stepLabel(entry: WorkflowNodeLog, actions: WorkflowActionMeta[]): string {
  if (entry.name) return entry.name;
  if (entry.kind !== 'action') return CONTROL_NODES[entry.kind]?.label ?? entry.kind;
  return actions.find((action) => action.type === entry.action)?.label ?? entry.action ?? '';
}

/** The run a call step started, to link to. */
export function calledRun(entry: WorkflowNodeLog): { workflowId: string; runId: string } | null {
  const { workflowId, runId } = entry.detail ?? {};
  return entry.kind === 'call' && typeof workflowId === 'string' && typeof runId === 'string'
    ? { workflowId, runId }
    : null;
}

/** Node key -> the status its last step reached; a failed pass wins. */
export function statusesOf(log: WorkflowNodeLog[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of log) {
    if (out[entry.key] !== 'failed') out[entry.key] = entry.status;
  }
  return out;
}

/** Translates server error keys; other messages pass through. */
function humanise(message: string | null): string {
  if (!message) return '';
  return /^[a-z]+(\.[a-zA-Z]+)+$/.test(message) ? messageForKey(message) : message;
}

/** A stored run or step message, in the admin's words when its key is known. */
export function runMessage(
  message: string | null,
  key?: string | null,
  params?: Record<string, unknown> | null,
): string {
  if (key && hasMessage(key)) return messageForKey(key, params ?? undefined);
  return humanise(message);
}

/** `1.2 s`, `340 ms`, `3 min`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

/** How long a run took, or has taken so far; empty before it started. */
export function runDuration(
  startedAt: string | Date | null,
  finishedAt: string | Date | null,
  now = Date.now(),
): string {
  if (!startedAt) return '';
  const end = finishedAt ? new Date(finishedAt).getTime() : now;
  return formatDuration(end - new Date(startedAt).getTime());
}
