import type { HookContextBase } from '@manablox/core';

declare module '@manablox/core' {
  interface ManabloxHooks {
    /** Before a site host name is added; throw to refuse it. */
    'website:beforeDomainCreate': [
      { spaceId: string; hostname: string; locale: string | null },
      HookContextBase,
    ];
    /** Before a site form submission becomes a record; throw to refuse it. */
    'website:beforeFormSubmit': [
      { spaceId: string; databagTypeId: string; form: string; locale: string; page: string },
      HookContextBase,
    ];
  }
}
