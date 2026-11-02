import type { PluginErrorKey, PluginErrorSpec } from '@manablox/core';

/** The website's error keys and their English sentences. */
export const websiteErrors: Record<PluginErrorKey, PluginErrorSpec> = {
  'plugins.website.settings.validation.failed': {
    kind: 'validation',
    message: 'The site settings could not be saved - see the parts marked.',
  },
  'plugins.website.design.notFound': {
    kind: 'not_found',
    message: 'That design no longer exists.',
  },
  'plugins.website.design.validation.failed': {
    kind: 'validation',
    message: 'The design could not be saved - some values are not accepted.',
  },
  'plugins.website.design.invalid': { kind: 'validation', message: 'This value is not accepted.' },
  'plugins.website.design.versionConflict': {
    kind: 'conflict',
    message:
      'Someone else saved this design while you were editing - reload it to see their changes.',
  },
  'plugins.website.design.version.notFound': {
    kind: 'not_found',
    message: 'That version of the design no longer exists.',
  },
  'plugins.website.design.key.invalid': {
    kind: 'validation',
    message: 'There is nothing of that name to design in this space.',
  },
  'plugins.website.design.notPublished': {
    kind: 'conflict',
    message: 'That design has not been published yet.',
  },
  'plugins.website.design.share.invalidExpiry': {
    message: 'A preview link lasts between a minute and 30 days.',
  },
  'plugins.website.theme.notFound': {
    kind: 'not_found',
    message: 'That theme is not in the gallery of this space.',
  },
  'plugins.website.theme.preset.notFound': {
    kind: 'not_found',
    message: 'There is no site design of that name.',
  },
  'plugins.website.theme.bundle.invalid': {
    message: 'That file is not a Manablox theme, or it is damaged: {issues}',
  },
  'plugins.website.theme.code.invalid': {
    message: 'A theme defined in code is not valid: {issues}',
  },
  'plugins.website.domain.notFound': {
    kind: 'not_found',
    message: 'That domain no longer exists.',
  },
  'plugins.website.domain.validation.failed': {
    kind: 'validation',
    message: 'The domain could not be saved - see the fields marked.',
  },
  'plugins.website.domain.hostname.invalid': {
    kind: 'validation',
    message: 'Enter a host name like www.example.com, without http:// or a path.',
  },
  'plugins.website.domain.hostname.taken': {
    kind: 'conflict',
    message: 'Another space already uses that domain.',
  },
  'plugins.website.domain.locale.unknown': {
    kind: 'validation',
    message: 'This space does not have the locale "{locale}".',
  },
};
