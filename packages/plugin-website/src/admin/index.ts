import { type AdminRoute, defineAdminPlugin } from '@manablox/admin-plugin';
import { useSessionStore } from '@manablox/admin-sdk';
import { invalidateDesign, invalidateSiteSettings } from './keys';
import { designedSiteFeature, websiteData } from './model/create-step';
import { FORM_PRESET } from './slots/form-preset-entry';
import './style.css';

/** The Design section's pages: lists beside the side nav, designers at full width. */
const ROUTES = (
  [
    {
      path: 'design',
      name: 'design',
      component: () => import('./pages/DesignOverview.vue'),
      panel: 'design',
    },
    {
      path: 'design/theme',
      name: 'design-theme',
      component: () => import('./pages/DesignTheme.vue'),
      editor: 'edit',
    },
    {
      path: 'design/blocks',
      name: 'design-blocks',
      component: () => import('./pages/DesignBlocks.vue'),
      panel: 'design',
    },
    {
      path: 'design/blocks/:typeId',
      name: 'design-block',
      component: () => import('./pages/DesignBlock.vue'),
      editor: 'edit',
    },
    {
      path: 'design/pages',
      name: 'design-pages',
      component: () => import('./pages/DesignPages.vue'),
      panel: 'design',
    },
    {
      path: 'design/pages/:typeId',
      name: 'design-page',
      component: () => import('./pages/DesignPage.vue'),
      editor: 'edit',
    },
    {
      path: 'design/layouts',
      name: 'design-layouts',
      component: () => import('./pages/DesignLayouts.vue'),
      panel: 'design',
    },
    {
      path: 'design/layouts/:key',
      name: 'design-layout',
      component: () => import('./pages/DesignLayout.vue'),
      editor: 'edit',
    },
    {
      path: 'design/menus',
      name: 'design-menus',
      component: () => import('./pages/DesignMenus.vue'),
      panel: 'design',
    },
    {
      path: 'design/menus/:key',
      name: 'design-menu',
      component: () => import('./pages/DesignMenu.vue'),
      editor: 'edit',
    },
    {
      path: 'design/site',
      name: 'design-site',
      component: () => import('./pages/DesignSite.vue'),
      panel: 'design',
      editor: 'edit',
    },
  ] satisfies AdminRoute[]
).map((route) => ({ ...route, section: '/design' }));

const DESIGN_ENTITY = {
  label: 'Site design',
  route: (_id: string | null, meta: Record<string, unknown> | null) =>
    meta?.kind === 'theme' ? '/design/theme' : '/design',
};
const DOMAIN_ENTITY = { label: 'Site domain', route: () => '/settings?tab=apiHosts' };

function importOutcome(meta: Record<string, unknown> | null): string | null {
  const { created, replaced } = meta ?? {};
  return typeof created === 'number' && typeof replaced === 'number'
    ? `${created} new, ${replaced} replaced`
    : null;
}

/** The visual designer and the designed site, through the admin's plugin slots. */
export default defineAdminPlugin({
  name: 'website',
  routes: ROUTES,
  menu: [
    {
      label: 'Design',
      icon: 'palette',
      to: '/design',
      group: 'structure',
      order: 300,
      permission: 'website:read',
      shortcut: 'e',
    },
  ],
  sidePanels: [
    {
      key: 'design',
      label: 'Design',
      icon: 'palette',
      component: () => import('./components/DesignSideNav.vue'),
    },
  ],
  slots: {
    'content.preview.target': [
      { key: 'canvas', feature: null, component: () => import('./slots/SiteCanvasTarget.vue') },
    ],
    'content.editor.actions': [
      { key: 'share', feature: null, component: () => import('./slots/SharePreviewAction.vue') },
    ],
    'block.inspector': [
      { key: 'style', feature: null, component: () => import('./slots/BlockStyleInspector.vue') },
    ],
    'contentType.actions': [
      {
        key: 'design',
        feature: null,
        permission: 'website:read',
        component: () => import('./slots/ContentTypeDesignLink.vue'),
      },
    ],
    'contentType.presets': [FORM_PRESET],
    'space.create.steps': [
      {
        key: 'design',
        feature: null,
        component: () => import('./slots/WebsiteCreateStep.vue'),
        stage: {
          label: 'Site design',
          title: 'Choose how the site looks',
          hint: 'The theme sets colors and fonts, the site design the header, footer, menus, sections and page layouts. The site is published with it right away.',
          welcome: 'For a designed site, you also pick how it looks.',
        },
        // Unchanged, the choice is the default the step showed.
        data: (draft) => {
          const session = useSessionStore();
          const { state } = designedSiteFeature((key) => session.feature(key, null));
          return websiteData(draft, state.enabled);
        },
      },
    ],
    'space.settings.sections': [
      { key: 'website', component: () => import('./slots/WebsiteSettingsSection.vue') },
    ],
    'space.domains': [
      {
        key: 'domains',
        permission: 'website:read',
        component: () => import('./slots/SiteDomainsSettings.vue'),
      },
    ],
    'environment.address': [
      { key: 'address', feature: null, component: () => import('./slots/SiteAddressLink.vue') },
    ],
  },
  transferSections: [
    {
      kind: 'website.designs',
      group: {
        id: 'site',
        label: 'Designed site',
        hint: 'How the site looks and where it lives',
        order: 300,
      },
      icon: 'palette',
      label: 'Site designs',
      description:
        'Theme, block, page, layout and menu designs and site settings, drafts and live copies.',
      noun: ['site design', 'site designs'],
    },
    {
      kind: 'website.domains',
      group: 'site',
      icon: 'globe',
      label: 'Domains',
      description:
        'The host names the site answers on. Off by default: a host name can only serve one space per instance.',
      optIn: true,
      noun: ['domain', 'domains'],
    },
  ],
  realtime: {
    'website.design': (event) => invalidateDesign(event.spaceId),
    'website.domain': (event) => invalidateDesign(event.spaceId),
    'website.settings': (event) => invalidateSiteSettings(event.spaceId),
  },
  audit: {
    entities: {
      'website.design': DESIGN_ENTITY,
      'website.domain': DOMAIN_ENTITY,
      'website.settings': { label: 'Site settings', route: () => '/settings' },
    },
    verbs: { 'website.settings.update': 'Site mode' },
    outcomes: { 'website.design.import': importOutcome },
  },
  features: {
    'plugins.website': 'The designed site',
    'plugins.website.design': 'Designing the site',
    'plugins.website.domains': 'Site domains',
    'plugins.website.forms': 'Site forms',
    'plugins.website.forms.config': 'Setting up site forms',
    'plugins.website.shareLinks': 'Share links',
    'plugins.website.password': 'Password-protected sites',
    'plugins.website.headCode': 'Custom site code',
    'plugins.website.badge': 'The site badge',
  },
  permissionIcons: { 'plugins.website': 'palette' },
  usage: {
    'plugins.website.formSubmissions': {
      label: 'Form submissions',
      blocked: 'Site forms are unavailable.',
    },
  },
  diffKinds: { designs: 'Site design' },
  // A promote replaces production's designs and domains.
  invalidateOnPromote: invalidateDesign,
});
