import { formatBytes, plural, relativeTime } from '@manablox/admin-sdk/lib/format';
import { describe, expect, it } from 'vitest';

describe('formatBytes', () => {
  it('reads kilobytes below a megabyte and one decimal above', () => {
    expect(formatBytes(512)).toBe('1 KB');
    expect(formatBytes(300 * 1024)).toBe('300 KB');
    expect(formatBytes(1.45 * 1024 * 1024)).toBe('1.4 MB');
  });
});

describe('plural', () => {
  it('counts with the noun, pluralised unless the form is given', () => {
    expect(plural(1, 'asset')).toBe('1 asset');
    expect(plural(3, 'asset')).toBe('3 assets');
    expect(plural(0, 'entry', 'entries')).toBe('0 entries');
  });
});

describe('relativeTime', () => {
  const now = Date.UTC(2026, 8, 6, 12, 0, 0);
  it('says "just now" inside a minute and counts minutes, hours and days after', () => {
    expect(relativeTime(new Date(now - 20_000), now)).toBe('just now');
    expect(relativeTime(new Date(now - 5 * 60_000), now)).toMatch(/5 minutes ago/);
    expect(relativeTime(new Date(now - 3 * 3_600_000), now)).toMatch(/3 hours ago/);
    expect(relativeTime(new Date(now + 2 * 86_400_000), now)).toMatch(/in 2 days/);
  });
});
