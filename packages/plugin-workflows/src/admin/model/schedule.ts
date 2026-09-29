export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export type SchedulePreset = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

/** The knobs the schedule form shows; every preset maps to and from a cron string. */
export interface ScheduleForm {
  preset: SchedulePreset;
  every: number;
  minute: number;
  hour: number;
  days: number[];
  dayOfMonth: number;
  cron: string;
}

export const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

/** The repeat choices, in the order the form lists them. */
export const SCHEDULE_PRESETS: Array<{ value: SchedulePreset; label: string }> = [
  { value: 'minutes', label: 'Every few minutes' },
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'On certain weekdays' },
  { value: 'monthly', label: 'Once a month' },
  { value: 'custom', label: 'Custom (cron)' },
];

/** Timezones the schedule form suggests; any IANA name is accepted. */
export const TIMEZONES = [
  'UTC',
  'Europe/Vienna',
  'Europe/Berlin',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Australia/Sydney',
];

/** How recently a selected document changed, in hours; 0 is any time. */
export const CHANGED_WITHIN = [
  { value: 0, label: 'Any time' },
  { value: 1, label: 'The last hour' },
  { value: 24, label: 'The last day' },
  { value: 168, label: 'The last week' },
  { value: 720, label: 'The last 30 days' },
];

export const SELECTION_STATUSES = [
  { value: 'any', label: 'Any' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
] as const;

const num = (value: string | undefined) =>
  value !== undefined && /^\d+$/.test(value) ? Number(value) : null;

/** Reads a cron back into the form, or falls back to `custom` for one the form cannot draw. */
export function scheduleFormFrom(cron: string): ScheduleForm {
  const form: ScheduleForm = {
    preset: 'custom',
    every: 15,
    minute: 0,
    hour: 8,
    days: [1, 2, 3, 4, 5],
    dayOfMonth: 1,
    cron,
  };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return form;
  const [m, h, dom, mon, dow] = parts as [string, string, string, string, string];
  if (mon !== '*') return form;

  const everyMatch = /^\*\/(\d+)$/.exec(m);
  if (everyMatch && h === '*' && dom === '*' && dow === '*') {
    return { ...form, preset: 'minutes', every: Number(everyMatch[1]) };
  }
  const minute = num(m);
  if (minute === null) return form;
  if (h === '*' && dom === '*' && dow === '*') return { ...form, preset: 'hourly', minute };
  const hour = num(h);
  if (hour === null) return form;
  if (dom === '*' && dow === '*') return { ...form, preset: 'daily', minute, hour };
  if (dom === '*') {
    const days = dow.split(',').map((day) => (day === '7' ? 0 : num(day)));
    if (days.every((day) => day !== null)) {
      return { ...form, preset: 'weekly', minute, hour, days: days as number[] };
    }
    return form;
  }
  const dayOfMonth = num(dom);
  if (dayOfMonth !== null && dow === '*')
    return { ...form, preset: 'monthly', minute, hour, dayOfMonth };
  return form;
}

export function cronFrom(form: ScheduleForm): string {
  switch (form.preset) {
    case 'minutes':
      return `*/${Math.min(59, Math.max(1, form.every))} * * * *`;
    case 'hourly':
      return `${form.minute} * * * *`;
    case 'daily':
      return `${form.minute} ${form.hour} * * *`;
    case 'weekly':
      return `${form.minute} ${form.hour} * * ${(form.days.length ? [...form.days].sort() : [1]).join(',')}`;
    case 'monthly':
      return `${form.minute} ${form.hour} ${form.dayOfMonth} * *`;
    case 'custom':
      return form.cron;
  }
}

const pad = (value: number) => String(value).padStart(2, '0');

export const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: pad(hour),
}));
export const MINUTES = Array.from({ length: 12 }, (_, i) => ({
  value: i * 5,
  label: pad(i * 5),
}));
export const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => ({
  value: i + 1,
  label: String(i + 1),
}));

/** A sentence for the list and the panel: "Every day at 08:00" rather than `0 8 * * *`. */
export function describeSchedule(cron: string, timezone: string): string {
  const form = scheduleFormFrom(cron);
  const at = `${pad(form.hour)}:${pad(form.minute)}`;
  const zone = timezone === 'UTC' ? 'UTC' : timezone.replace(/_/g, ' ');
  switch (form.preset) {
    case 'minutes':
      return form.every === 1 ? 'Every minute' : `Every ${form.every} minutes`;
    case 'hourly':
      return form.minute === 0 ? 'Every hour' : `Every hour at :${pad(form.minute)}`;
    case 'daily':
      return `Every day at ${at} (${zone})`;
    case 'weekly': {
      const names = WEEKDAYS.filter((day) => form.days.includes(day.value)).map((day) => day.label);
      return `${names.join(', ')} at ${at} (${zone})`;
    }
    case 'monthly':
      return `Day ${form.dayOfMonth} of every month at ${at} (${zone})`;
    case 'custom':
      return `${cron} (${zone})`;
  }
}
