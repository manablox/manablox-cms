import { defineAdminPlugin } from '@manablox/admin-plugin';

/** A page with a menu entry, a space wizard step, a settings section and an entry in `hello-extra`'s slot. */
export default defineAdminPlugin({
  name: 'hello',
  routes: [
    { path: '/hello', name: 'hello-greetings', component: () => import('./GreetingsPage.vue') },
  ],
  menu: [{ label: 'Greetings', icon: 'star', to: '/hello', group: 'content', order: 900 }],
  slots: {
    'space.settings.sections': [{ component: () => import('./GreetingSettings.vue') }],
    'space.create.steps': [{ component: () => import('./GreetingCreateStep.vue') }],
    'hello-extra:board': [{ component: () => import('./BoardGreetings.vue') }],
  },
});
