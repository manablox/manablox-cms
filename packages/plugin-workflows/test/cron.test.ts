import { describe, expect, it } from 'vitest';
import {
  cronMatches,
  floorToMinute,
  isValidTimezone,
  parseCron,
  wallClock,
} from '../src/server/cron.js';

const at = (iso: string) => new Date(iso);

describe('parseCron', () => {
  it('accepts the common forms', () => {
    expect(parseCron('* * * * *')).not.toBeNull();
    expect(parseCron('0 8 * * 1-5')).not.toBeNull();
    expect(parseCron('*/15 * * * *')).not.toBeNull();
    expect(parseCron('0 0 1 jan,jul *')).not.toBeNull();
    expect(parseCron('30 6 * * sun')).not.toBeNull();
    expect(parseCron('5/10 * * * *')?.minute).toEqual(new Set([5, 15, 25, 35, 45, 55]));
  });

  it('rejects what it cannot read', () => {
    expect(parseCron('')).toBeNull();
    expect(parseCron('* * * *')).toBeNull();
    expect(parseCron('60 * * * *')).toBeNull();
    expect(parseCron('* 24 * * *')).toBeNull();
    expect(parseCron('*/0 * * * *')).toBeNull();
    expect(parseCron('a b c d e')).toBeNull();
    expect(parseCron('5-3 * * * *')).toBeNull();
  });

  it('treats 7 as Sunday', () => {
    expect(parseCron('0 0 * * 7')?.dayOfWeek).toEqual(new Set([0]));
  });
});

describe('cronMatches', () => {
  it('matches a plain minute', () => {
    const spec = parseCron('30 14 * * *')!;
    expect(cronMatches(spec, at('2026-09-06T14:30:00Z'), 'UTC')).toBe(true);
    expect(cronMatches(spec, at('2026-09-06T14:31:00Z'), 'UTC')).toBe(false);
  });

  it('reads the wall-clock in the workflow timezone', () => {
    const spec = parseCron('0 8 * * *')!;
    // 08:00 in Vienna during summer time is 06:00 UTC.
    expect(cronMatches(spec, at('2026-07-01T06:00:00Z'), 'Europe/Vienna')).toBe(true);
    expect(cronMatches(spec, at('2026-07-01T08:00:00Z'), 'Europe/Vienna')).toBe(false);
    expect(cronMatches(spec, at('2026-07-01T08:00:00Z'), 'UTC')).toBe(true);
  });

  it('crosses the date line correctly for weekdays', () => {
    // Saturday 23:30 in Los Angeles is Sunday 06:30 UTC.
    const clock = wallClock(at('2026-09-06T06:30:00Z'), 'America/Los_Angeles');
    expect(clock).toMatchObject({ hour: 23, minute: 30, dayOfWeek: 6, dayOfMonth: 5 });
  });

  it('combines the day fields like Vixie cron', () => {
    // Either the 1st of the month or a Monday.
    const spec = parseCron('0 0 1 * 1')!;
    expect(cronMatches(spec, at('2026-09-01T00:00:00Z'), 'UTC')).toBe(true); // Tuesday the 1st
    expect(cronMatches(spec, at('2026-09-07T00:00:00Z'), 'UTC')).toBe(true); // Monday the 7th
    expect(cronMatches(spec, at('2026-09-08T00:00:00Z'), 'UTC')).toBe(false);
    // With `*` in day-of-month, only the weekday counts.
    expect(cronMatches(parseCron('0 0 * * 1')!, at('2026-09-01T00:00:00Z'), 'UTC')).toBe(false);
  });

  it('handles midnight as hour 0', () => {
    expect(cronMatches(parseCron('0 0 * * *')!, at('2026-09-06T00:00:00Z'), 'UTC')).toBe(true);
  });
});

describe('helpers', () => {
  it('validates timezones', () => {
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Europe/Vienna')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });

  it('floors to the minute', () => {
    expect(floorToMinute(at('2026-09-06T14:30:59.999Z')).toISOString()).toBe(
      '2026-09-06T14:30:00.000Z',
    );
  });
});
