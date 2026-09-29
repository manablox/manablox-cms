/** Five-field cron matching in a named timezone. Match-only; no next-run computation. */

export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** `*` in the day-of-month field; decides how the two day fields combine. */
  anyDayOfMonth: boolean;
  anyDayOfWeek: boolean;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface FieldSpec {
  min: number;
  max: number;
  names?: string[];
  /** Day-of-week accepts 7 for Sunday as well as 0. */
  alias?: Record<number, number>;
}

const FIELDS: FieldSpec[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: MONTHS },
  { min: 0, max: 6, names: DAYS, alias: { 7: 0 } },
];

function parseValue(raw: string, field: FieldSpec): number | null {
  const lower = raw.toLowerCase();
  if (field.names) {
    const index = field.names.indexOf(lower);
    if (index !== -1) return field.min + index;
  }
  if (!/^\d+$/.test(raw)) return null;
  let value = Number(raw);
  if (field.alias && value in field.alias) value = field.alias[value] as number;
  if (value < field.min || value > field.max) return null;
  return value;
}

// One comma-separated part: `*`, `n`, `a-b`, `a/s`, `a-b/s`, or a star with a step.
function parsePart(part: string, field: FieldSpec, into: Set<number>): boolean {
  const [rangePart, stepPart] = part.split('/');
  if (rangePart === undefined || stepPart === '') return false;

  let step = 1;
  if (stepPart !== undefined) {
    if (!/^\d+$/.test(stepPart)) return false;
    step = Number(stepPart);
    if (step < 1) return false;
  }

  let from: number;
  let to: number;
  if (rangePart === '*') {
    from = field.min;
    to = field.max;
  } else if (rangePart.includes('-')) {
    const [a, b] = rangePart.split('-');
    const start = a === undefined ? null : parseValue(a, field);
    const end = b === undefined ? null : parseValue(b, field);
    if (start === null || end === null || end < start) return false;
    from = start;
    to = end;
  } else {
    const value = parseValue(rangePart, field);
    if (value === null) return false;
    from = value;
    // `5/10` means "from 5, every 10".
    to = stepPart !== undefined ? field.max : value;
  }

  for (let value = from; value <= to; value += step) into.add(value);
  return true;
}

export function parseCron(expression: string): CronSpec | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const sets: Set<number>[] = [];
  for (const [index, raw] of fields.entries()) {
    const field = FIELDS[index] as FieldSpec;
    const set = new Set<number>();
    for (const part of raw.split(',')) {
      if (!part || !parsePart(part, field, set)) return null;
    }
    sets.push(set);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = sets as [
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
  ];
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    anyDayOfMonth: fields[2] === '*',
    anyDayOfWeek: fields[4] === '*',
  };
}

export function isValidCron(expression: string): boolean {
  return parseCron(expression) !== null;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export interface WallClock {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

/** The wall-clock reading of an instant in a timezone. */
export function wallClock(date: Date, timezone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    minute: 'numeric',
    hour: 'numeric',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    minute: Number(read('minute')),
    hour: Number(read('hour')) % 24,
    dayOfMonth: Number(read('day')),
    month: Number(read('month')),
    dayOfWeek: DAYS.indexOf(read('weekday').toLowerCase().slice(0, 3)),
  };
}

/** Whether the minute containing `date` matches. Restricted day fields are ORed, as in Vixie cron. */
export function cronMatches(spec: CronSpec, date: Date, timezone: string): boolean {
  const clock = wallClock(date, timezone);
  if (!spec.minute.has(clock.minute)) return false;
  if (!spec.hour.has(clock.hour)) return false;
  if (!spec.month.has(clock.month)) return false;

  const domMatch = spec.dayOfMonth.has(clock.dayOfMonth);
  const dowMatch = spec.dayOfWeek.has(clock.dayOfWeek);
  if (spec.anyDayOfMonth && spec.anyDayOfWeek) return true;
  if (spec.anyDayOfMonth) return dowMatch;
  if (spec.anyDayOfWeek) return domMatch;
  return domMatch || dowMatch;
}

/** The start of the minute containing `date`. */
export function floorToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}
