import { RunError } from '@manablox/core';
import type { WorkflowActionContext } from '../../define/action.js';
import type { WorkflowFieldSpec } from '../../sdk.js';
import { WORKFLOWS } from '../keys.js';

export { looksLikeJson } from '../template.js';

/** Normalizes a `keyValue` field to `{name, value}` rows; non-text values become templates. */
export function keyValueRows(raw: unknown): Array<{ name: string; value: string }> {
  const text = (value: unknown): string =>
    typeof value === 'string'
      ? value
      : value === undefined || value === null
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  if (Array.isArray(raw)) {
    return raw.map((entry) => {
      const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      return { name: text(row.name ?? row.key), value: text(row.value) };
    });
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([name, value]) => ({ name, value: text(value) }));
  }
  return [];
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

/** Reads a response as JSON when it says it is, and keeps the text either way. */
export async function readResponse(
  response: Response,
): Promise<{ text: string; body: unknown; json: boolean }> {
  const text = await response.text().catch(() => '');
  const type = response.headers.get('content-type') ?? '';
  if (/\bjson\b/i.test(type) || /^\s*[[{]/.test(text)) {
    try {
      return { text, body: JSON.parse(text), json: true };
    } catch {
      // A wrong content-type does not fail the step.
    }
  }
  return { text, body: text, json: false };
}

/** Response headers as a lower-cased plain object. */
export function headerMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name.toLowerCase()] = value;
  });
  return out;
}

/** Combines run cancellation and the step deadline into one signal. */
export function withDeadline(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

/** Shared `continueOnError` / retry fields. */
export const timeoutField: WorkflowFieldSpec = {
  name: 'timeoutMs',
  label: 'Give up after',
  kind: 'number',
  min: 1000,
  max: 120_000,
  step: 500,
  width: 'half',
  hint: 'Milliseconds.',
};

/** A mail node's failure when no address came out of its recipients. */
export const noRecipient = (): RunError =>
  new RunError('plugins.workflows.run.recipientMissing', {}, 'No recipient address resolved');

/** Reports a sent mail through `mail:afterSend`; `account` is the editor's own mailbox. */
export function mailSent(
  ctx: Pick<WorkflowActionContext, 'manablox' | 'workflow'>,
  recipients: number,
  transport: 'instance' | 'account',
): Promise<void> {
  const { manablox, workflow } = ctx;
  return manablox.hooks.observe(
    'mail:afterSend',
    { spaceId: workflow.spaceId, kind: WORKFLOWS, recipients, transport },
    { manablox, spaceId: workflow.spaceId },
  );
}
