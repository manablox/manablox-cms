import { ManabloxError, type ResolvedScope } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { SiteDesignKind } from '@manablox/site';
import type { SiteDesignKindName } from '../../shared/site.js';
import { designAuditor } from '../audit.js';
import type { SiteDesignRow, SiteDesignVersionRow, SiteDesignVersionSummary } from '../db/index.js';
import { websiteRepos } from '../db/index.js';
import { type DesignContext, findDesign } from './design/context.js';
import {
  deleteDesign,
  discardDesignDraft,
  restoreDesign,
  type SiteDesignSaveInput,
  saveDesignDraft,
} from './design/drafts.js';
import { publishAllDesigns, publishDesign } from './design/publish.js';
import { createShareLink } from './design/share.js';
import {
  designDetail,
  listDesigns,
  type SiteDesignDetail,
  type SiteDesignSummary,
} from './design/summary.js';

// Fails to compile when the kinds of `@manablox/core` and `@manablox/site` drift apart.
const _sameKinds: [SiteDesignKind, SiteDesignKindName] extends [SiteDesignKindName, SiteDesignKind]
  ? true
  : never = true;

/**
 * Design documents of a designed site: drafts with an optimistic version, publish (one or
 * all, bumping the space's site revision), versions and restore. A design without a row is
 * generated at render time; deleting one resets it to generated. The parts live in `design/`.
 */
export class SiteDesignService {
  private readonly ctx: DesignContext;

  constructor(
    private readonly manablox: Manablox,
    repos: Repositories,
  ) {
    this.ctx = { manablox, repos, audit: designAuditor(repos) };
  }

  using(repos: Repositories): SiteDesignService {
    return new SiteDesignService(this.manablox, repos);
  }

  /** Every design the space has or implies, with its status. */
  list(scope: string | ResolvedScope): Promise<SiteDesignSummary[]> {
    return listDesigns(this.ctx, scope);
  }

  /** One design; generated when nothing is stored. */
  get(
    scope: string | ResolvedScope,
    kind: SiteDesignKindName,
    key: string,
  ): Promise<SiteDesignDetail> {
    return designDetail(this.ctx, scope, kind, key);
  }

  async getById(scope: string | ResolvedScope, id: string): Promise<SiteDesignRow> {
    return findDesign(this.ctx, scope, id);
  }

  /**
   * Validates and stores a draft. The first save of a generated design creates its row; later
   * saves need the stored `version`, so a stale editor gets a conflict instead of overwriting.
   */
  saveDraft(
    scope: string | ResolvedScope,
    input: SiteDesignSaveInput,
    actorId: string | null = null,
  ): Promise<SiteDesignRow> {
    return saveDesignDraft(this.ctx, scope, input, actorId);
  }

  /** Makes one design's draft live and bumps the site revision; a clean design is left alone. */
  publish(
    scope: string | ResolvedScope,
    id: string,
    actorId: string | null = null,
  ): Promise<SiteDesignRow> {
    return publishDesign(this.ctx, scope, id, actorId);
  }

  /** Publishes every design with changes in one transaction, so the site never mixes them. */
  publishAll(
    scope: string | ResolvedScope,
    actorId: string | null = null,
  ): Promise<{ published: SiteDesignRow[]; revision: number }> {
    return publishAllDesigns(this.ctx, scope, actorId);
  }

  /** Sets the draft back to the live copy; a never published design goes back to generated. */
  discardDraft(
    scope: string | ResolvedScope,
    id: string,
    actorId: string | null = null,
  ): Promise<SiteDesignRow | null> {
    return discardDesignDraft(this.ctx, scope, id, actorId);
  }

  /** Publish snapshots, newest first. */
  async versions(scope: string | ResolvedScope, id: string): Promise<SiteDesignVersionSummary[]> {
    await findDesign(this.ctx, scope, id);
    return websiteRepos(this.ctx.repos).designs.listVersions(id);
  }

  async version(
    scope: string | ResolvedScope,
    id: string,
    versionId: string,
  ): Promise<SiteDesignVersionRow> {
    await findDesign(this.ctx, scope, id);
    const row = await websiteRepos(this.ctx.repos).designs.findVersion(id, versionId);
    if (!row)
      throw ManabloxError.notFound('plugins.website.design.version.notFound', { id, versionId });
    return row;
  }

  /** Copies a snapshot into the draft; publishing it is a separate step. */
  async restore(
    scope: string | ResolvedScope,
    id: string,
    versionId: string,
    actorId: string | null = null,
  ): Promise<SiteDesignRow> {
    const row = await findDesign(this.ctx, scope, id);
    const snapshot = await this.version(scope, id, versionId);
    return restoreDesign(this.ctx, scope, row, snapshot, actorId);
  }

  /** Resets a design to generated; a live one changes the site, so the revision moves. */
  delete(scope: string | ResolvedScope, id: string): Promise<void> {
    return deleteDesign(this.ctx, scope, id);
  }

  /**
   * A signed, time-limited token for draft previews of the space, or of one document in it.
   * The caller composes the site URL.
   */
  createShareLink(
    scope: string | ResolvedScope,
    input: { contentId?: string | null | undefined; expiresInSeconds?: number | undefined },
  ): Promise<{ token: string; expiresAt: Date }> {
    return createShareLink(this.ctx, scope, input);
  }
}
