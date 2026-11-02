import { describe, expect, it } from 'vitest';
import { locateSitePath, SiteUrls, withSiteLinks } from '../../src/server/services/site/urls.js';

const space = { defaultLocale: 'en', locales: ['en', 'de', 'fr'] };
const neutral = { hostname: 'example.test', locale: null };

describe('locateSitePath', () => {
  it('reads the locale from the first segment, the default one unprefixed', () => {
    expect(locateSitePath(space, neutral, '/')).toEqual({ locale: 'en', permalink: '' });
    expect(locateSitePath(space, neutral, '/about/team/')).toEqual({
      locale: 'en',
      permalink: 'about/team',
    });
    expect(locateSitePath(space, neutral, '/de/ueber')).toEqual({
      locale: 'de',
      permalink: 'ueber',
    });
    expect(locateSitePath(space, neutral, '/de')).toEqual({ locale: 'de', permalink: '' });
    expect(locateSitePath(space, neutral, '/en/about')).toEqual({ redirect: '/about' });
    // Decoded slashes stay encoded, so the target is never another host.
    expect(locateSitePath(space, neutral, '/en/%2F%2Fevil.test')).toEqual({
      redirect: '/%2F%2Fevil.test',
    });
    expect(locateSitePath(space, neutral, '/en/\\evil.test')).toEqual({
      redirect: '/%5Cevil.test',
    });
    expect(locateSitePath(space, neutral, '/caf%C3%A9')).toEqual({
      locale: 'en',
      permalink: 'café',
    });
  });

  it('keeps a pinned host in its locale', () => {
    expect(locateSitePath(space, { hostname: 'de.test', locale: 'de' }, '/de/x')).toEqual({
      locale: 'de',
      permalink: 'de/x',
    });
  });
});

describe('SiteUrls', () => {
  const domains = [
    { hostname: 'example.test', locale: null, isPrimary: true },
    { hostname: 'beispiel.test', locale: 'de', isPrimary: true },
  ];

  it('prefixes locales on the locale-less primary host', () => {
    const urls = new SiteUrls(
      space,
      { localeStrategy: 'prefix' },
      domains,
      neutral,
      'https:',
      null,
    );
    expect(urls.href('de', 'ueber')).toBe('/de/ueber');
    expect(urls.href('en', '')).toBe('/');
    expect(urls.absolute('fr', '')).toBe('https://example.test/fr');
  });

  it('sends pinned locales to their own host with the domain strategy', () => {
    const urls = new SiteUrls(space, { localeStrategy: 'domain' }, domains, neutral, 'https:', 'h');
    expect(urls.href('de', 'ueber')).toBe('https://beispiel.test/ueber');
    expect(urls.href('fr', 'a b')).toBe('/fr/a%20b');
    expect(urls.permalinkOf({ localizationId: 'h', permalink: 'home' })).toBe('');
    expect(urls.origin('de')).toBe('https://beispiel.test');
  });
});

describe('withSiteLinks', () => {
  const urls = new SiteUrls(
    space,
    { localeStrategy: 'prefix' },
    [{ hostname: 'example.test', locale: null, isPrimary: true }],
    neutral,
    'https:',
    null,
  );

  it('turns delivered permalinks into links of the site', () => {
    const fields = {
      related: [{ id: 'c1', type: 'page', title: 'Team', permalink: 'about/team', locale: 'de' }],
      cta: { mode: 'internal', contentId: 'c2', href: 'contact' },
      external: { mode: 'external', url: 'https://x.test', href: 'https://x.test' },
      blocks: {
        blocks: [{ fields: { more: { id: 'c3', title: 'Home', permalink: '', locale: 'en' } } }],
      },
      plain: 'about',
    };
    expect(withSiteLinks(fields, urls, 'fr')).toEqual({
      related: [
        { id: 'c1', type: 'page', title: 'Team', permalink: '/de/about/team', locale: 'de' },
      ],
      cta: { mode: 'internal', contentId: 'c2', href: '/fr/contact' },
      external: fields.external,
      blocks: {
        blocks: [{ fields: { more: { id: 'c3', title: 'Home', permalink: '/', locale: 'en' } } }],
      },
      plain: 'about',
    });
  });
});
