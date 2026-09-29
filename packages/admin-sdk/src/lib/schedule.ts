import type { Ref } from 'vue';
import { runWrite } from './write';

/** Scheduled publishing dates, converted between `datetime-local` and `Date`. */
export interface ScheduleWindow {
  publishAt: string | Date | null;
  unpublishAt: string | Date | null;
}

/** An empty string when unset. */
export function toLocalInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  // Local wall-clock time; `toISOString` would shift to UTC.
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `null` for an empty input. */
export function fromLocalInput(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whether either end is still in the future. */
export function isPending(window: ScheduleWindow, now = new Date()): boolean {
  return [window.publishAt, window.unpublishAt].some(
    (at) => at !== null && new Date(at).getTime() > now.getTime(),
  );
}

/** A window as the schedule procedures take it. */
export interface ScheduleDates {
  publishAt: Date | null;
  unpublishAt: Date | null;
}

/**
 * Saves a schedule window: holds `busy`, toasts "<noun> saved" while an end is still
 * ahead or "<noun> cleared" otherwise, and hands the stored window to `onSaved`.
 */
export function saveScheduleWindow(
  write: (dates: ScheduleDates) => Promise<ScheduleWindow>,
  window: ScheduleWindow,
  feedback: { busy: Ref<boolean>; noun: string; onSaved?: (stored: ScheduleWindow) => void },
): Promise<boolean> {
  let stored: ScheduleWindow = window;
  return runWrite(
    async () => {
      stored = await write({
        publishAt: window.publishAt as Date | null,
        unpublishAt: window.unpublishAt as Date | null,
      });
      feedback.onSaved?.(stored);
    },
    {
      busy: feedback.busy,
      success: () => `${feedback.noun} ${isPending(stored) ? 'saved' : 'cleared'}`,
    },
  );
}
