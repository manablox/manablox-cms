import type { ControlScopeKind, PluginControls } from '@manablox/core';
import { z } from 'zod';

const IS: ControlScopeKind[] = ['instance', 'space'];

/** Features, usage, rate limits, retention and badge settings under `plugins.website`. */
export const websiteControls = {
  'features.plugins.website.design': {
    label: 'Site design',
    description:
      'Designing sites: site, theme, page, layout, block and menu designs, design presets, themes and AI design.',
  },
  'features.plugins.website.domains': {
    label: 'Site domains',
    description: 'Adding and changing site domains; the existing ones keep serving.',
  },
  'features.plugins.website.forms': {
    label: 'Site forms',
    description: 'Site forms and their submissions.',
  },
  'features.plugins.website.forms.config': {
    label: 'Setting up site forms',
    description: 'Adding and changing site forms; the existing ones keep taking submissions.',
  },
  'features.plugins.website.badge': {
    label: 'Site badge',
    description: 'Shows the "Made with Manablox" badge on sites when on.',
    enabled: false,
    resolution: 'mostSpecific',
  },
  'features.plugins.website.password': {
    label: 'Password-protected sites',
    description: 'Password-protected sites.',
  },
  'features.plugins.website.headCode': {
    label: 'Custom site code',
    description: 'Custom head and body-end code on sites.',
  },
  'features.plugins.website.shareLinks': {
    label: 'Share links',
    description: 'Preview share links.',
  },
  'usage.plugins.website.formSubmissions': {
    label: 'Form submissions',
    description: 'Form submissions per period.',
    nouns: ['form submission', 'form submissions'],
  },
  'rateLimits.plugins.website.ip': {
    description: 'Site requests per IP.',
    scopes: IS,
    default: { max: 1200, windowSeconds: 60 },
  },
  'rateLimits.plugins.website.renders': {
    description: 'Site renders (cache misses) per space.',
  },
  'rateLimits.plugins.website.password': {
    description: 'Site password attempts per IP and space.',
    scopes: IS,
    default: { max: 10, windowSeconds: 600 },
  },
  'rateLimits.plugins.website.forms.ip': {
    description: 'Form submissions per IP.',
    scopes: IS,
    default: { max: 10, windowSeconds: 600 },
  },
  'rateLimits.plugins.website.forms.space': {
    description: 'Form submissions per space.',
  },
  'retention.plugins.website.designVersionsCount': {
    description: 'Site design versions kept, by count.',
  },
  'plugins.website.badge.text': {
    description: 'Text of the site badge.',
    default: 'Made with Manablox',
    schema: z.string().trim().min(1).max(80),
  },
  'plugins.website.badge.link': {
    description: 'Link of the site badge.',
    default: 'https://manablox.io',
    schema: z.url({ protocol: /^https?$/ }),
  },
} satisfies PluginControls;
