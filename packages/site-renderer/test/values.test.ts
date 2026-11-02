import type { SiteRenderInput } from '@manablox/site';
import { describe, expect, it } from 'vitest';
import { createContext } from '../src/context.js';
import { formatValue } from '../src/values.js';

const ctx = createContext(
  { mode: 'live', locale: 'en', space: { defaultLocale: 'en' } } as SiteRenderInput,
  {},
);

describe('formatValue', () => {
  it('shows a related document by its title, though it has a type', () => {
    const related = { id: 'd1', type: 'service', title: 'Consulting', permalink: '/consulting' };
    const def = { id: 'f', name: 'services', type: 'content', settings: {} };
    expect(formatValue(related, def, undefined, ctx)).toBe('Consulting');
  });

  it('leaves out the thousands separator on request', () => {
    expect(formatValue(2025, null, { type: 'number' }, ctx)).toBe('2,025');
    expect(formatValue(2025, null, { type: 'number', grouping: false }, ctx)).toBe('2025');
  });
});
