/** Shared formatters. `Intl` objects are built once since construction is slow. */

const date = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });
const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** `1.4 MB`, `312 KB`. */
export function formatBytes(bytes: number): string {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

/** `6 Sep 2026`, in the viewer's locale. */
export function formatDate(value: string | Date): string {
  return date.format(new Date(value));
}

/** `6 Sep 2026, 14:30`, in the viewer's locale. */
export function formatDateTime(value: string | Date): string {
  return dateTime.format(new Date(value));
}

/** `14:30:07`, in the viewer's locale. */
export function formatTime(value: string | Date): string {
  return time.format(new Date(value));
}

/** `6 Sep 2026, 14:30:07`. */
export function formatTimestamp(value: string | Date): string {
  return timestamp.format(new Date(value));
}

/** `Today`, `Yesterday`, or the date. */
export function dayLabel(value: string | Date, now = new Date()): string {
  const day = new Date(value);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(day)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.format(day);
}

/** `just now`, `5 minutes ago`, `yesterday`, `in 3 days`. */
export function relativeTime(value: string | Date, now = Date.now()): string {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86400), 'day');
}

/** `1 asset`, `3 assets`. */
export function plural(count: number, noun: string, pluralForm = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralForm}`;
}
