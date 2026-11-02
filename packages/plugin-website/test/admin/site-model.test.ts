import { previewHostname } from '@manablox/admin-sdk';
import { defaultSiteSettings, validateSiteDesign } from '@manablox/site';
import { describe, expect, it } from 'vitest';
import { currentPrimary, domainUrl } from '../../src/admin/model/site-domains';
import {
  layoutOf,
  titlePatternWarnings,
  titlePreview,
  withLayout,
  withLocalized,
} from '../../src/admin/model/site-settings';

describe('title pattern', () => {
  it('fills {title} and {site} like the renderer', () => {
    expect(titlePreview('{title} | {site}', 'About', 'Acme')).toBe('About | Acme');
    expect(titlePreview('{site}: {title} ({title})', 'About', 'Acme')).toBe('Acme: About (About)');
    expect(titlePreview('', 'About', 'Acme')).toBe('About | Acme');
    expect(titlePreview('  {title}  ', 'About', 'Acme')).toBe('About');
  });

  it('shows the site name alone without a page title, and the title alone without a name', () => {
    expect(titlePreview('{title} | {site}', '', 'Acme')).toBe('Acme');
    expect(titlePreview('{title} | {site}', 'About', '')).toBe('About');
  });

  it('warns about unknown placeholders, a missing {title} and the length limit', () => {
    expect(titlePatternWarnings('{title} | {site}')).toEqual([]);
    expect(titlePatternWarnings('')).toEqual([]);
    expect(titlePatternWarnings('{title} - {brand} {brand}')).toEqual([
      '{brand} is not replaced; only {title} and {site} are.',
    ]);
    expect(titlePatternWarnings('{site}')[0]).toMatch(/Without \{title\}/);
    expect(titlePatternWarnings(`{title}${'x'.repeat(200)}`)[0]).toMatch(/under 200/);
  });

  it('builds drafts the site validator accepts', () => {
    const site = defaultSiteSettings();
    const next = {
      ...site,
      titlePattern: '{title} - {site}',
      meta: { description: withLocalized(undefined, 'en', 'Hello') ?? {} },
      layouts: withLayout(site.layouts, 'type-1', 'landing'),
    };
    expect(validateSiteDesign('site', next).ok).toBe(true);
    expect(layoutOf(next, 'type-1')).toBe('landing');
    expect(layoutOf(next, 'type-2')).toBe('default');
    expect(withLayout(next.layouts, 'type-1', 'default')).toEqual({});
    expect(withLocalized({ en: 'a', de: 'b' }, 'de', '')).toEqual({ en: 'a' });
    expect(withLocalized({ en: 'a' }, 'en', '')).toBeUndefined();
  });
});

describe('hostname preview', () => {
  it('normalises like the server', () => {
    expect(previewHostname('WWW.Example.com')).toBe('www.example.com');
    expect(previewHostname('https://www.example.com:8443/path?q=1')).toBe('www.example.com');
    expect(previewHostname('example.com.')).toBe('example.com');
    expect(previewHostname('localhost:3200')).toBe('localhost');
    expect(previewHostname('bücher.de')).toBe('xn--bcher-kva.de');
    expect(previewHostname('[::1]:3000')).toBe('[::1]');
  });

  it('rejects what is not a host name', () => {
    for (const bad of ['', '  ', 'foo bar.com', '-bad.com', 'under_score.com', 'user@host.com']) {
      expect(previewHostname(bad)).toBeNull();
    }
  });

  it('opens local names over http on the site port', () => {
    expect(domainUrl('www.example.com', 'http://localhost:3200')).toBe('https://www.example.com');
    expect(domainUrl('localhost', 'http://localhost:3200')).toBe('http://localhost:3200');
    expect(domainUrl('shop.test', 'https://site.example.com')).toBe('http://shop.test');
    expect(domainUrl('localhost', null)).toBe('http://localhost');
  });

  it('finds the primary a new primary would replace', () => {
    const rows = [
      { id: 'a', locale: null, isPrimary: true },
      { id: 'b', locale: 'de', isPrimary: true },
      { id: 'c', locale: null, isPrimary: false },
    ];
    expect(currentPrimary(rows, null, null)?.id).toBe('a');
    expect(currentPrimary(rows, 'de', 'b')).toBeNull();
    expect(currentPrimary(rows, 'fr', null)).toBeNull();
  });
});
