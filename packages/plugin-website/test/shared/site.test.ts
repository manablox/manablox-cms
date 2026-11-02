import { permissionsFor, registerPluginCatalogue } from '@manablox/core';
import { describe, expect, it } from 'vitest';
import { signSiteAccess, verifySiteAccess } from '../../src/server/access.js';
import { websitePlugin } from '../../src/server/plugin.js';
import { signSiteShare, verifySiteShare } from '../../src/server/share.js';
import { spaceSiteSettings } from '../../src/shared/site.js';

describe('spaceSiteSettings', () => {
  it('fills in defaults and drops malformed values', () => {
    expect(spaceSiteSettings({})).toEqual({
      mode: 'external',
      revision: 0,
      localeStrategy: 'prefix',
      notFoundContentId: null,
      password: null,
    });
    expect(
      spaceSiteSettings({
        mode: 'designed',
        revision: 3,
        localeStrategy: 'nope',
        notFoundContentId: 5,
        password: 7,
      }),
    ).toEqual({
      mode: 'designed',
      revision: 3,
      localeStrategy: 'prefix',
      notFoundContentId: null,
      password: null,
    });
  });
});

describe('site access cookies', () => {
  const subject = { spaceId: 's1', passwordHash: '$argon2id$one' };
  const expiresAt = new Date(Date.now() + 60_000);

  it('holds for its space and password until it expires', () => {
    const token = signSiteAccess('secret', subject, expiresAt);
    expect(verifySiteAccess('secret', token, subject)).toBe(true);
    expect(verifySiteAccess('other', token, subject)).toBe(false);
    expect(verifySiteAccess('secret', token, { ...subject, spaceId: 's2' })).toBe(false);
    // A new password invalidates earlier cookies.
    expect(verifySiteAccess('secret', token, { ...subject, passwordHash: '$argon2id$two' })).toBe(
      false,
    );
    expect(verifySiteAccess('secret', token, subject, new Date(expiresAt.getTime() + 1000))).toBe(
      false,
    );
    const [expires, sig] = token.split('.');
    expect(verifySiteAccess('secret', `${Number(expires) + 3600}.${sig}`, subject)).toBe(false);
    expect(verifySiteAccess('secret', `${token}.x`, subject)).toBe(false);
    expect(verifySiteAccess('secret', 'garbage', subject)).toBe(false);
  });
});

describe('site share tokens', () => {
  const expiresAt = new Date(Date.now() + 60_000);

  it('round-trips a payload and refuses a tampered, foreign or expired token', () => {
    const token = signSiteShare('secret', { spaceId: 's1', contentId: 'c1', expiresAt });
    const payload = verifySiteShare('secret', token);
    expect(payload).toEqual({
      spaceId: 's1',
      contentId: 'c1',
      expiresAt: new Date(Math.floor(expiresAt.getTime() / 1000) * 1000),
    });
    expect(verifySiteShare('other', token)).toBeNull();
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ s: 's2', e: 9_999_999_999 })).toString('base64url');
    expect(verifySiteShare('secret', `${forged}.${sig}`)).toBeNull();
    expect(verifySiteShare('secret', `${body}.${sig}.x`)).toBeNull();
    expect(verifySiteShare('secret', token, new Date(expiresAt.getTime() + 1000))).toBeNull();
  });

  it('leaves the document out of a whole-site token', () => {
    const token = signSiteShare('secret', { spaceId: 's1', expiresAt });
    expect(verifySiteShare('secret', token)).not.toHaveProperty('contentId');
    expect(verifySiteShare('secret', token)).not.toHaveProperty('environmentId');
  });

  it('carries the environment of a staging preview', () => {
    const token = signSiteShare('secret', { spaceId: 's1', environmentId: 'e1', expiresAt });
    expect(verifySiteShare('secret', token)).toMatchObject({ spaceId: 's1', environmentId: 'e1' });
  });
});

describe('website permissions', () => {
  it('gives editors design work without code or domains', () => {
    registerPluginCatalogue([websitePlugin()]);
    const editor = permissionsFor('editor');
    expect(editor).toEqual(
      expect.arrayContaining(['website:read', 'website:write', 'website:publish']),
    );
    expect(editor).not.toContain('website:code');
    expect(editor).not.toContain('website:domains');
    expect(permissionsFor('admin')).toEqual(
      expect.arrayContaining(['website:code', 'website:domains']),
    );
    expect(permissionsFor('author')).not.toContain('website:read');
  });
});
