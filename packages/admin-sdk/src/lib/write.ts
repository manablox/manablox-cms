import type { FeatureKey } from '@manablox/core';
import type { Ref } from 'vue';
import { useSessionStore } from '../stores/session';
import { errorDetails, errorKey } from './api-errors';
import { type ConfirmOptions, confirm } from './confirm';
import { showLocked } from './features';
import { messageFor } from './messages';
import { toast } from './toast';

export interface WriteFeedback<T> {
  /** Toasted on success; a function sees the result. */
  success?: string | ((result: T) => string);
  /** Holds the failure message; cleared when the write starts. */
  error?: Ref<string | null>;
  /** True while the write runs; a write is skipped while it is already true. */
  busy?: Ref<boolean>;
  /** The failure sentence; `messageFor` by default. */
  describe?: (error: unknown) => string;
}

/** Runs a write: toasts the outcome, fills `error`, holds `busy`. Resolves to success. */
export async function runWrite<T>(
  fn: () => Promise<T>,
  feedback: WriteFeedback<T> = {},
): Promise<boolean> {
  const { success, error, busy, describe = messageFor } = feedback;
  if (busy?.value) return false;
  if (busy) busy.value = true;
  if (error) error.value = null;
  try {
    const result = await fn();
    if (success) toast.success(typeof success === 'function' ? success(result) : success);
    return true;
  } catch (caught) {
    const message = describe(caught);
    if (error) error.value = message;
    if (!handleControlError(caught)) toast.error(message);
    return false;
  } finally {
    if (busy) busy.value = false;
  }
}

/** Asks first, then runs the write; resolves false when dismissed or failed. */
export async function confirmAndRun<T>(
  options: ConfirmOptions,
  fn: () => Promise<T>,
  feedback: WriteFeedback<T> = {},
): Promise<boolean> {
  if (!(await confirm(options))) return false;
  return runWrite(fn, feedback);
}

/**
 * A `control.*` refusal, or a pending two-factor enrolment: the session refetches, which
 * shows the change. A switched-off feature opens the locked dialog; true when it did, so the
 * caller skips its toast.
 */
function handleControlError(error: unknown): boolean {
  const key = errorKey(error);
  if (!key.startsWith('control.') && key !== 'auth.twoFactor.enrolmentRequired') return false;
  const session = useSessionStore();
  void session.revalidate(true);
  if (key !== 'control.feature') return false;
  const params = errorDetails(error)[0]?.params ?? {};
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  const feature = text(params.feature);
  if (!feature) return false;
  showLocked({
    feature: feature as FeatureKey,
    message: text(params.message),
    link: text(params.link) ?? session.me?.controls.links.upgrade ?? null,
  });
  return true;
}
