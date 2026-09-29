import { describe, expect, it } from 'vitest';
import { authMail } from '../src/mails.js';
import { policyCovers } from '../src/two-factor.js';

const expiresAt = new Date('2026-10-01T12:00:00Z');

describe('auth mails', () => {
  it('confirms an address with its one-time link', () => {
    const mail = authMail({
      kind: 'verifyEmail',
      name: 'Ada',
      email: 'ada@new.test',
      change: true,
      url: 'http://admin.test/verify-email?token=t',
      expiresAt,
    });
    expect(mail.subject).toBe('Confirm your email address');
    expect(mail.text).toContain('use ada@new.test for your Manablox account');
    expect(mail.text).toContain('http://admin.test/verify-email?token=t');
    expect(mail.text).toContain('October 1, 2026');
  });

  it('names the inviter and the spaces of an invitation', () => {
    const mail = authMail({
      kind: 'invite',
      inviter: 'Grace',
      spaces: ['Blog', 'Shop', 'Docs'],
      url: 'http://admin.test/accept-invite?token=t',
      expiresAt,
    });
    expect(mail.subject).toBe('Grace invited you to Manablox');
    expect(mail.text).toContain('work in Blog, Shop, and Docs on Manablox');
    expect(mail.text).toContain('http://admin.test/accept-invite?token=t');
  });

  it('tells about new backup codes and falls back to English', () => {
    const mail = authMail({
      kind: 'backupCodes',
      name: 'Ada',
      at: expiresAt,
      url: 'http://admin.test/profile?tab=security',
      locale: 'xx-YY',
    });
    expect(mail.subject).toMatch(/backup codes/);
    expect(mail.text).toContain('The old codes no longer work.');
    expect(mail.text).toContain('http://admin.test/profile?tab=security');
  });
});

describe('the two-factor policy', () => {
  const editor = { role: 'editor', spaces: { s1: 'editor' } };
  const spaceAdmin = { role: 'editor', spaces: { s1: 'viewer', s2: 'admin' } };
  const owner = { role: 'editor', spaces: { s1: 'owner' } };
  const superadmin = { role: 'superadmin', spaces: {} };

  it('covers nobody, everyone, or superadmins and space owners and admins', () => {
    for (const subject of [editor, spaceAdmin, owner, superadmin]) {
      expect(policyCovers('off', subject)).toBe(false);
      expect(policyCovers('all', subject)).toBe(true);
    }
    expect(policyCovers('admins', editor)).toBe(false);
    expect(policyCovers('admins', spaceAdmin)).toBe(true);
    expect(policyCovers('admins', owner)).toBe(true);
    expect(policyCovers('admins', superadmin)).toBe(true);
  });
});
