import type { Me } from '@manablox/admin-sdk/lib/api-types';

/** A signed-in editor whose controls switch off `databags` (locked) and `menus` (hidden in s1). */
export function meWithControls(): Me {
  return {
    id: 'u1',
    email: 'a@example.com',
    name: 'A',
    image: null,
    role: 'editor',
    spaces: { s1: 'owner' },
    permissions: { s1: [] },
    controls: {
      features: { databags: { presentation: 'locked', message: 'Upgrade for databags' } },
      links: { upgrade: 'https://example.com/upgrade' },
      banners: [],
      state: { status: 'active', message: null },
      apiKeysDisable: false,
      spaces: {
        s1: {
          features: {
            databags: { presentation: 'locked', message: 'Upgrade for databags' },
            menus: { presentation: 'hidden' },
            tags: { presentation: 'locked', link: 'https://example.com/tags' },
          },
        },
      },
    },
  } as unknown as Me;
}
