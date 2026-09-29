import { pluginRepos } from '@manablox/db';
import { LicenseActivationRepository } from './repository.js';

/** The license rows on the connection or transaction `repos` is bound to. */
export const licenseRepos = pluginRepos((context) => new LicenseActivationRepository(context));

export * from './repository.js';
