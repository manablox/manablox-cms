import { pluginKeys } from '@manablox/admin-sdk';

const license = pluginKeys('license');

/** Query keys of the license plugin; its keys are the instance's, in no space. */
export const licenseKeys = {
  overview: () => [...license.all(null), 'overview'] as const,
};

/** The keys and products, with the open activity log. */
export const invalidateLicenses = () => license.invalidate(null);
