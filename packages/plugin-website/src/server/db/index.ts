import { pluginRepos } from '@manablox/db';
import { SiteDesignRepository } from './repositories/design.js';
import { SiteDomainRepository } from './repositories/domain.js';

export interface WebsiteRepositories {
  designs: SiteDesignRepository;
  domains: SiteDomainRepository;
}

/** The plugin's repositories on the connection or transaction `repos` is bound to. */
export const websiteRepos = pluginRepos(
  (context): WebsiteRepositories => ({
    designs: new SiteDesignRepository(context),
    domains: new SiteDomainRepository(context),
  }),
);

export * from './repositories/design.js';
export * from './repositories/domain.js';
export * from './rows.js';
