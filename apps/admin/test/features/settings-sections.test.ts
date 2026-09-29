import { describe, expect, it } from 'vitest';
import { availableSections, resolveSection } from '~/features/settings/sections';

const ids = (context: Parameters<typeof availableSections>[0]) =>
  availableSections(context).map((entry) => entry.id);

const member = { isSuperadmin: false, hasSpace: true, importing: false, can: () => true };

describe('settings sections', () => {
  it('lists the space sections before the instance ones', () => {
    expect(ids(member)).toEqual([
      'general',
      'members',
      'roles',
      'tags',
      'credentials',
      'apiHosts',
      'environments',
      'transfer',
      'backups',
      'usage',
      'spaces',
      'keys',
    ]);
  });

  it('shows users, security and instance usage to superadmins only', () => {
    expect(ids({ ...member, isSuperadmin: true })).toEqual(
      expect.arrayContaining(['users', 'security', 'instanceUsage']),
    );
  });

  it('shows the space usage to those who edit the space settings', () => {
    expect(ids({ ...member, can: (permission) => permission !== 'space:write' })).not.toContain(
      'usage',
    );
  });

  it('drops a section whose permission is missing', () => {
    const withoutExport = ids({ ...member, can: (permission) => permission !== 'space:export' });
    expect(withoutExport).not.toContain('transfer');
    expect(withoutExport).not.toContain('backups');
  });

  it('keeps only General of a space still importing', () => {
    expect(ids({ ...member, importing: true })).toEqual(['general', 'spaces', 'keys']);
  });

  it('falls back to General, or to Spaces without a space', () => {
    expect(resolveSection('nope', availableSections(member)).id).toBe('general');
    expect(resolveSection('roles', availableSections(member)).id).toBe('roles');
    const noSpace = availableSections({ ...member, hasSpace: false });
    expect(resolveSection('roles', noSpace).id).toBe('spaces');
    expect(resolveSection(undefined, noSpace).id).toBe('spaces');
  });

  it('drops a hidden feature and marks a locked one', () => {
    const state = (hidden: boolean) => ({
      enabled: false,
      hidden,
      locked: !hidden,
      message: null,
      link: null,
    });
    const available = availableSections({
      ...member,
      feature: (key) =>
        key === 'tags'
          ? state(true)
          : key === 'customRoles'
            ? state(false)
            : { enabled: true, hidden: false, locked: false, message: null, link: null },
    });
    expect(available.map((entry) => entry.id)).not.toContain('tags');
    expect(available.find((entry) => entry.id === 'roles')?.locked).toBe(true);
    expect(available.find((entry) => entry.id === 'general')?.locked).toBe(false);
  });
});
