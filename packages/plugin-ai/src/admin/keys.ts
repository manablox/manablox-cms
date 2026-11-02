import { pluginKeys } from '@manablox/admin-sdk';

const ai = pluginKeys('ai');

/** Query keys of the AI plugin; providers and settings are per space, not per environment. */
export const aiKeys = {
  all: ai.all,
  catalog: () => ['ai', 'catalog'] as const,
  providers: (spaceId: string | null) => [...ai.all(spaceId), 'providers'] as const,
  available: (spaceId: string | null) => [...ai.all(spaceId), 'available'] as const,
  settings: (spaceId: string | null) => [...ai.all(spaceId), 'settings'] as const,
  generations: (spaceId: string | null, params: { page: number }) =>
    [...ai.all(spaceId), 'generations', params] as const,
};

/** Providers, settings and generations of a space, with the open activity log. */
export const invalidateAi = ai.invalidate;
