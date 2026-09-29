import type { AdminMenuItem } from '@manablox/admin-plugin';
import { FEATURE_ON, type FeatureState } from '@manablox/admin-sdk/lib/features';
import { describe, expect, it } from 'vitest';
import { menuEntries } from '~/stores/menu';

const items: AdminMenuItem[] = [
  { label: 'Content', to: '/content' },
  { label: 'Menus', to: '/menus', permission: 'menu:read', feature: 'menus' },
  { label: 'Tags', to: '/tags', feature: 'tags' },
  { label: 'Databags', to: '/databags', feature: 'databags' },
];

const off = (presentation: 'hidden' | 'locked'): FeatureState => ({
  enabled: false,
  hidden: presentation === 'hidden',
  locked: presentation === 'locked',
  message: null,
  link: null,
});

describe('menuEntries', () => {
  it('drops hidden features and entries without the permission, and marks locked ones', () => {
    const entries = menuEntries(items, {
      can: (permission) => permission !== 'menu:read',
      feature: (key) =>
        key === 'tags' ? off('hidden') : key === 'databags' ? off('locked') : FEATURE_ON,
    });
    expect(entries.map((entry) => [entry.to, entry.locked])).toEqual([
      ['/content', false],
      ['/databags', true],
    ]);
  });
});
