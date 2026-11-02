import type { ResolvedScope } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import { requireInSpace } from '@manablox/services';
import type { designAuditor } from '../../audit.js';
import type { SiteDesignRow } from '../../db/index.js';
import { websiteRepos } from '../../db/index.js';

/** What the parts of `SiteDesignService` share. */
export interface DesignContext {
  manablox: Manablox;
  repos: Repositories;
  audit: ReturnType<typeof designAuditor>;
}

/** Theme and site designs, and the first layout, are stored under this key. */
export const DEFAULT_KEY = 'default';

/** A stored design of the space; not found otherwise. */
export async function findDesign(
  ctx: DesignContext,
  scope: string | ResolvedScope,
  id: string,
): Promise<SiteDesignRow> {
  return requireInSpace(
    await websiteRepos(ctx.repos).designs.findById(id, scope),
    scope,
    'plugins.website.design.notFound',
    { id },
  );
}
