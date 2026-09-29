import { defineAdminPlugin } from '@manablox/admin-plugin';

declare module '@manablox/admin-plugin' {
  interface AdminSlotProps {
    'hello-extra:board': { spaceId: string };
  }
}

/** A board page with its own slot, and an api other bundles use. */
export default defineAdminPlugin({
  name: 'hello-extra',
  routes: [
    { path: '/hello-extra', name: 'hello-extra-board', component: () => import('./BoardPage.vue') },
  ],
  menu: [
    { label: 'Greeting board', icon: 'star', to: '/hello-extra', group: 'content', order: 910 },
  ],
  setup({ defineSlot, expose }) {
    defineSlot('board');
    expose({ decorate: (text: string) => `* ${text} *` });
  },
});
