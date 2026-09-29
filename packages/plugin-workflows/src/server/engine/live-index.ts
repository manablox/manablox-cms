import type { SpaceScope } from '@manablox/core';
import type { Repositories } from '@manablox/db';
import type { LiveWorkflow } from '../db/index.js';
import { workflowRepos } from '../db/index.js';

/**
 * How long a space's live triggers are reused. Writes drop them at once, in other processes
 * via `forgetLive`; a missed announcement is seen within this window.
 */
const LIVE_TTL_MS = 5_000;

/** Spaces whose live triggers are kept at once. */
const LIVE_SPACES_KEPT = 500;

/**
 * `<spaceId>` (production) or `<spaceId>:<environmentId>` -> the environment's live workflows'
 * triggers, see `LIVE_TTL_MS`.
 */
export class LiveTriggerIndex {
  private readonly entries = new Map<string, { at: number; workflows: Promise<LiveWorkflow[]> }>();

  constructor(
    private readonly repos: Repositories,
    /** Off with `cache.enabled: false`: every lookup reads the database. */
    private readonly keep = true,
  ) {}

  /** Drops every entry of a space, or of every space without one. */
  forget(spaceId?: string): void {
    if (spaceId === undefined) {
      this.entries.clear();
      return;
    }
    for (const key of [...this.entries.keys()]) {
      if (key === spaceId || key.startsWith(`${spaceId}:`)) this.entries.delete(key);
    }
  }

  /**
   * An environment's live workflows without graphs, from the index when fresh; a space id
   * alone is its production environment.
   */
  liveIn(scope: string | SpaceScope): Promise<LiveWorkflow[]> {
    const key = typeof scope === 'string' ? scope : `${scope.spaceId}:${scope.environmentId}`;
    const now = Date.now();
    const cached = this.entries.get(key);
    if (cached && now - cached.at < LIVE_TTL_MS) return cached.workflows;
    const filter = typeof scope === 'string' ? { spaceId: scope } : scope;
    if (!this.keep) return workflowRepos(this.repos).workflows.listLive(filter);
    const entry = { at: now, workflows: workflowRepos(this.repos).workflows.listLive(filter) };
    this.entries.delete(key);
    if (this.entries.size >= LIVE_SPACES_KEPT) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, entry);
    entry.workflows.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return entry.workflows;
  }
}
