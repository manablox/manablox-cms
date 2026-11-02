import type { Scope } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { HostVerificationData, Repositories } from '@manablox/db';
import { dateOrNull, type HostVerifier } from '@manablox/services';
import { type DesignTypeRef, validateSiteDesign } from '@manablox/site';
import type { SiteDesignKindName } from '../shared/site.js';
import type { SiteDesignRow, SiteDomainRow } from './db/index.js';
import { websiteRepos } from './db/index.js';
import { fitDesign, resolveDesignType, typeRef } from './services/theme/design-types.js';

export interface ExportedSiteDesign {
  kind: SiteDesignKindName;
  /** A type id for block and page designs. */
  key: string;
  name: string;
  draft: unknown;
  /** `null` while never published. */
  published: unknown;
  /** Whether the draft has changes the live copy lacks. */
  changed: boolean;
  publishedAt: string | null;
  /** Block and page designs: the type by name and field paths, to find it again. */
  type?: DesignTypeRef;
}

export interface ExportedSiteDomain {
  hostname: string;
  locale: string | null;
  isPrimary: boolean;
  redirectToPrimary: boolean;
}

const toExportedSiteDesign = (row: SiteDesignRow): ExportedSiteDesign => ({
  kind: row.kind,
  key: row.key,
  name: row.name,
  draft: row.draft,
  published: row.published ?? null,
  changed: row.publishedVersion !== null && row.publishedVersion !== row.version,
  publishedAt: row.publishedAt?.toISOString() ?? null,
});

export const toExportedSiteDomain = (row: SiteDomainRow): ExportedSiteDomain => ({
  hostname: row.hostname,
  locale: row.locale,
  isPrimary: row.isPrimary,
  redirectToPrimary: row.redirectToPrimary,
});

/** Stored designs with the type each block and page design styles. */
export async function allSiteDesigns(
  manablox: Manablox,
  repos: Repositories,
  scope: Scope,
): Promise<ExportedSiteDesign[]> {
  return (await websiteRepos(repos).designs.listBySpace(scope)).map((row) => {
    const exported = toExportedSiteDesign(row);
    const type =
      row.kind === 'block' || row.kind === 'page' ? manablox.contentTypes.tryGet(row.key) : null;
    return type ? { ...exported, type: typeRef(type) } : exported;
  });
}

/**
 * Writes designs with their draft and live copy. Block and page designs follow their type by
 * id, else by name; ones whose type is missing are skipped with a note.
 */
export async function importSiteDesigns(
  manablox: Manablox,
  repos: Repositories,
  spaceId: string,
  designs: ExportedSiteDesign[],
  actorId: string | null,
): Promise<string[]> {
  const notes: string[] = [];
  const written = new Set<string>();
  for (const design of designs) {
    let key = design.key;
    let draft = design.draft;
    let published: unknown = design.published ?? null;
    if (design.kind === 'block' || design.kind === 'page') {
      const type = resolveDesignType(manablox, spaceId, design.kind, design.key, design.type);
      if (!type) {
        notes.push(
          `The ${design.kind} design for "${design.type?.name ?? design.key}" was skipped: the type is missing.`,
        );
        continue;
      }
      key = type.id;
      draft = fitDesign(design.kind, draft, design.type, type);
      if (published !== null) published = fitDesign(design.kind, published, design.type, type);
    }
    if (written.has(`${design.kind}:${key}`)) continue;
    if (
      !validateSiteDesign(design.kind, draft).ok ||
      (published !== null && !validateSiteDesign(design.kind, published).ok)
    ) {
      notes.push(`The ${design.kind} design "${design.name || key}" was skipped: it is invalid.`);
      continue;
    }
    written.add(`${design.kind}:${key}`);

    const live = published !== null;
    const row = await websiteRepos(repos).designs.restore({
      spaceId,
      kind: design.kind,
      key,
      name: design.name,
      draft,
      published,
      version: live && design.changed ? 2 : 1,
      publishedVersion: live ? 1 : null,
      publishedAt: live ? (dateOrNull(design.publishedAt) ?? new Date()) : null,
      actorId,
    });
    // The live copy becomes the design's only version.
    if (live) {
      await websiteRepos(repos).designs.addVersion({
        designId: row.id,
        spaceId,
        version: 1,
        data: published,
        actorId,
      });
    }
  }
  return notes;
}

/**
 * Host names are unique per instance; ones taken here are skipped with a note. The rest start
 * with `verification`, as if added by hand.
 */
export async function importSiteDomains(
  repos: Repositories,
  spaceId: string,
  domains: ExportedSiteDomain[],
  verifier: HostVerifier,
): Promise<string[]> {
  const notes: string[] = [];
  const verification: HostVerificationData = await verifier.initial();
  for (const domain of domains) {
    if (await verifier.owner(domain.hostname)) {
      notes.push(`The domain ${domain.hostname} was skipped: another space uses it.`);
      continue;
    }
    await websiteRepos(repos).domains.create(spaceId, {
      hostname: domain.hostname,
      locale: domain.locale,
      isPrimary: domain.isPrimary,
      redirectToPrimary: domain.redirectToPrimary,
      ...verification,
    });
  }
  return notes;
}
