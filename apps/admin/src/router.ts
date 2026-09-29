import { syncEnvironment } from '@manablox/admin-sdk/lib/environment';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import type { FeatureKey } from '@manablox/core';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import type { SidePanelKey } from '~/components/layout/side-panels';
import { SHELL_ROUTE } from '~/features/plugins/install';
import { isInstalling, setupNeeded } from '~/features/users/install';

declare module 'vue-router' {
  interface RouteMeta {
    /** Reachable signed out. */
    public?: boolean;
    /** False keeps the page when no space exists. */
    needsSpace?: boolean;
    /** The sidebar entry (its `to`) the route belongs to. */
    section?: string;
    /** The side list shown beside the page. */
    panel?: SidePanelKey;
    /** An editor route, for a new record or an existing one. */
    editor?: 'new' | 'edit';
    /** Features the page needs; one switched off shows the locked panel instead. */
    features?: readonly FeatureKey[];
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('~/pages/Login.vue'),
    meta: { public: true },
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('~/pages/ForgotPassword.vue'),
    meta: { public: true },
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('~/pages/ResetPassword.vue'),
    meta: { public: true },
  },
  {
    path: '/two-factor',
    name: 'two-factor',
    component: () => import('~/pages/TwoFactorChallenge.vue'),
    meta: { public: true },
  },
  {
    path: '/verify-email',
    name: 'verify-email',
    component: () => import('~/pages/VerifyEmail.vue'),
    meta: { public: true },
  },
  {
    path: '/accept-invite',
    name: 'accept-invite',
    component: () => import('~/pages/AcceptInvite.vue'),
    meta: { public: true },
  },
  // Signed in, outside the shell: the two-factor policy asks for enrolment first.
  {
    path: '/two-factor/setup',
    name: 'two-factor-setup',
    component: () => import('~/pages/TwoFactorSetup.vue'),
  },
  {
    path: '/install',
    name: 'install',
    component: () => import('~/pages/Install.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    name: SHELL_ROUTE,
    component: () => import('~/pages/Shell.vue'),
    children: [
      {
        path: '',
        name: 'dashboard',
        component: () => import('~/pages/Dashboard.vue'),
        meta: { section: '/' },
      },
      {
        path: 'content',
        name: 'content',
        component: () => import('~/pages/ContentList.vue'),
        meta: { section: '/content', panel: 'tree' },
      },
      {
        path: 'content/new/:typeId',
        name: 'content-new',
        component: () => import('~/pages/ContentEdit.vue'),
        meta: { section: '/content', panel: 'tree', editor: 'new' },
      },
      {
        path: 'content/:id',
        name: 'content-edit',
        component: () => import('~/pages/ContentEdit.vue'),
        meta: { section: '/content', panel: 'tree', editor: 'edit' },
      },
      {
        path: 'templates',
        name: 'templates',
        component: () => import('~/pages/TemplateList.vue'),
        meta: { section: '/templates', panel: 'templates' },
      },
      // Templates use the document editor under their own path to keep the sidebar on Templates.
      {
        path: 'templates/new',
        name: 'template-new',
        component: () => import('~/pages/ContentEdit.vue'),
        meta: { section: '/templates', panel: 'templates', editor: 'new' },
      },
      {
        path: 'templates/:id',
        name: 'template-edit',
        component: () => import('~/pages/ContentEdit.vue'),
        meta: { section: '/templates', panel: 'templates', editor: 'edit' },
      },
      {
        path: 'types',
        name: 'types',
        component: () => import('~/pages/ContentTypeList.vue'),
        meta: { section: '/types', panel: 'types' },
      },
      {
        path: 'types/new',
        name: 'type-new',
        component: () => import('~/pages/ContentTypeEdit.vue'),
        meta: { section: '/types', panel: 'types', editor: 'new' },
      },
      {
        path: 'types/:id',
        name: 'type-edit',
        component: () => import('~/pages/ContentTypeEdit.vue'),
        meta: { section: '/types', panel: 'types', editor: 'edit' },
      },
      // Databag entries use the document editor under their type's path.
      {
        path: 'databags',
        name: 'databags',
        component: () => import('~/pages/DatabagList.vue'),
        meta: { section: '/databags', panel: 'databags', features: ['databags'] },
      },
      {
        path: 'databags/:typeId',
        name: 'databag-entries',
        component: () => import('~/pages/DatabagEntries.vue'),
        meta: { section: '/databags', panel: 'databags', features: ['databags'] },
      },
      {
        path: 'databags/:typeId/new',
        name: 'databag-new',
        component: () => import('~/pages/ContentEdit.vue'),
        meta: { section: '/databags', panel: 'databags', editor: 'new', features: ['databags'] },
      },
      {
        path: 'databags/:typeId/:id',
        name: 'databag-edit',
        component: () => import('~/pages/ContentEdit.vue'),
        meta: { section: '/databags', panel: 'databags', editor: 'edit', features: ['databags'] },
      },
      {
        path: 'databag-types',
        name: 'databag-types',
        component: () => import('~/pages/DatabagTypeList.vue'),
        meta: { section: '/databag-types', panel: 'databagTypes', features: ['databags'] },
      },
      {
        path: 'databag-types/new',
        name: 'databag-type-new',
        component: () => import('~/pages/ContentTypeEdit.vue'),
        meta: {
          section: '/databag-types',
          panel: 'databagTypes',
          editor: 'new',
          features: ['databags'],
        },
      },
      {
        path: 'databag-types/:id',
        name: 'databag-type-edit',
        component: () => import('~/pages/ContentTypeEdit.vue'),
        meta: {
          section: '/databag-types',
          panel: 'databagTypes',
          editor: 'edit',
          features: ['databags'],
        },
      },
      {
        path: 'redirects',
        name: 'redirects',
        component: () => import('~/pages/Redirects.vue'),
        meta: { section: '/redirects' },
      },
      {
        path: 'menus',
        name: 'menus',
        component: () => import('~/pages/MenuList.vue'),
        meta: { section: '/menus', panel: 'menus', features: ['menus'] },
      },
      {
        path: 'menus/:id',
        name: 'menu-edit',
        component: () => import('~/pages/MenuEdit.vue'),
        meta: { section: '/menus', panel: 'menus', editor: 'edit', features: ['menus'] },
      },
      {
        path: 'assets',
        name: 'assets',
        component: () => import('~/pages/Assets.vue'),
        meta: { section: '/assets' },
      },
      {
        path: 'activity',
        name: 'activity',
        component: () => import('~/pages/Activity.vue'),
        meta: { section: '/activity' },
      },
      // Not space-scoped.
      {
        path: 'notifications',
        name: 'notifications',
        component: () => import('~/pages/Notifications.vue'),
        meta: { section: '/notifications', needsSpace: false },
      },
      {
        path: 'profile',
        name: 'profile',
        component: () => import('~/pages/Profile.vue'),
        meta: { section: '/profile', needsSpace: false },
      },
      // Where the first space is created.
      {
        path: 'settings',
        name: 'settings',
        component: () => import('~/pages/Settings.vue'),
        meta: { section: '/settings', panel: 'settings', needsSpace: false },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('~/pages/NotFound.vue') },
];

export const router = createRouter({ history: createWebHistory(), routes });

let pluginsReady: Promise<unknown> = Promise.resolve();

/**
 * Holds navigations until the plugins are installed (their routes, menus and registries), for
 * every page but the public ones; set once at boot.
 */
export function waitForPlugins(ready: Promise<unknown>): void {
  pluginsReady = ready;
}

router.beforeEach(async (to) => {
  const session = useSessionStore();
  const plugins = to.meta.public ? null : pluginsReady;
  await Promise.all([session.loading ? session.refresh() : null, plugins]);
  // Matched before a plugin added its routes: match again.
  if (plugins && to.name === 'not-found' && router.resolve(to.fullPath).name !== 'not-found') {
    return to.fullPath;
  }

  // Without accounts the wizard replaces login; it stays reachable while it runs.
  if (to.name === 'install') {
    if (isInstalling() || (await setupNeeded())) return true;
    return { name: session.isAuthenticated ? 'dashboard' : 'login' };
  }
  if (!session.isAuthenticated && (await setupNeeded())) return { name: 'install' };

  if (to.meta.public) {
    const signedInOnly = to.name === 'login' || to.name === 'two-factor';
    return session.isAuthenticated && signedInOnly ? { name: 'dashboard' } : true;
  }
  if (!session.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  // Nothing else opens until two-factor is set up.
  const enrolling = session.me?.twoFactor?.pending === true;
  if (enrolling && to.name !== 'two-factor-setup') {
    return { name: 'two-factor-setup', query: { redirect: to.fullPath } };
  }
  if (!enrolling && to.name === 'two-factor-setup') return { name: 'dashboard' };
  // Links drop `?env=`; the working environment goes back on.
  return syncEnvironment(to, useSpaceStore().currentId);
});
