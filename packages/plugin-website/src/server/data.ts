import { defineDataProvider, type HostSource, HostVerifier } from '@manablox/services';
import { siteCacheTags } from '../shared/site.js';
import { type SiteDesignRow, type SiteDomainRow, websiteRepos } from './db/index.js';
import { websiteKeys } from './keys.js';
import { SITE_HOST_KIND } from './services/domain.service.js';
import { NOT_FOUND_NOMINATION } from './services/settings.service.js';
import {
  allSiteDesigns,
  type ExportedSiteDesign,
  type ExportedSiteDomain,
  importSiteDesigns,
  importSiteDomains,
  toExportedSiteDomain,
} from './transfer.js';

/** Site domains as a host source. */
const SITE_HOST_SOURCE: HostSource<SiteDomainRow> = {
  kind: SITE_HOST_KIND,
  cacheTag: siteCacheTags.domains,
  find: (repos, hostname) => websiteRepos(repos).domains.findByHostname(hostname),
  pending: (repos, limit) => websiteRepos(repos).domains.listPendingVerification(limit),
  setVerification: (repos, id, data) => websiteRepos(repos).domains.setVerification(id, data),
  moveSpace: (repos, from, to) => websiteRepos(repos).domains.moveSpace(from, to),
  eventFields: (row) => ({ locale: row.locale }),
  listBySpace: (repos, spaceId) => websiteRepos(repos).domains.listBySpace(spaceId),
  viewFields: (row) => ({ locale: row.locale, isPrimary: row.isPrimary }),
};

const designs = defineDataProvider<SiteDesignRow, ExportedSiteDesign>({
  kind: 'website.designs',
  environments: {
    key: 'designs',
    load: ({ repos, environmentId }) =>
      websiteRepos(repos).designs.listByEnvironment(environmentId),
    // Keys naming a type id follow the types.
    match: (row, ids) => `${row.kind}\n${ids.remap(row.key)}`,
    keep: (row) => row.source !== 'runtime',
    describe: (row) => ({
      label: row.name || `${row.kind} ${row.key}`,
      value: { name: row.name, draft: row.draft, published: row.published },
    }),
    copy: ({ repos, rows }) => websiteRepos(repos).designs.insertRows(rows),
    async promote({ repos, upsert, remove, production }) {
      const rows = websiteRepos(repos).designs;
      const before = new Map(production.map((design) => [design.id, design]));
      await rows.removeRows(remove.map((row) => row.id));
      for (const design of upsert) {
        const previous = before.get(design.id);
        if (!previous) continue;
        // A new version, so open editors see a conflict; a dirty draft stays dirty.
        const version = previous.version + 1;
        const clean = design.publishedVersion === design.version;
        await rows.updateRow(design.id, {
          name: design.name,
          draft: design.draft,
          published: design.published,
          version,
          publishedVersion:
            design.publishedVersion === null ? null : clean ? version : previous.version,
          publishedAt: design.publishedAt,
          publishedBy: design.publishedBy,
          updatedAt: new Date(),
          updatedBy: design.updatedBy,
        });
      }
      await rows.insertRows(upsert.filter((row) => !before.has(row.id)));
    },
    nominations: [NOT_FOUND_NOMINATION],
  },
  transfer: {
    section: { label: 'Site designs', dependsOn: ['contentTypes'] },
    count: async ({ repos, spaceId }) =>
      (await websiteRepos(repos).designs.listBySpace(spaceId)).length,
    export: ({ manablox, repos, scope }) => allSiteDesigns(manablox, repos, scope),
    async import({ manablox, repos, spaceId, actorId, notes }, entries) {
      notes.push(...(await importSiteDesigns(manablox, repos, spaceId, entries, actorId)));
    },
  },
  retention: [
    {
      key: websiteKeys.retention.designVersionsCount,
      // Uncounted.
      prune: async ({ repos, spaceId }, keep) => {
        await websiteRepos(repos).designs.pruneVersions(spaceId, keep);
        return 0;
      },
    },
  ],
  cacheTags: (spaceId) => [siteCacheTags.design(spaceId)],
});

const domains = defineDataProvider<{ id: string }, ExportedSiteDomain>({
  kind: 'website.domains',
  transfer: {
    // Host names are unique per instance.
    section: { label: 'Domains', optIn: true },
    count: async ({ repos, spaceId }) =>
      (await websiteRepos(repos).domains.listBySpace(spaceId)).length,
    export: async ({ repos, scope }) =>
      (await websiteRepos(repos).domains.listBySpace(scope)).map(toExportedSiteDomain),
    limits: (entries) => ({ customDomains: entries.length }),
    async check({ manablox, spaceId }, entries) {
      if (!manablox.hooks.has('website:beforeDomainCreate')) return;
      for (const domain of entries) {
        await manablox.hooks.run(
          'website:beforeDomainCreate',
          { spaceId, hostname: domain.hostname, locale: domain.locale },
          { manablox, spaceId },
        );
      }
    },
    async import({ manablox, repos, spaceId, notes }, entries) {
      const verifier = new HostVerifier(manablox, repos);
      notes.push(...(await importSiteDomains(repos, spaceId, entries, verifier)));
    },
  },
  counters: {
    customDomains: ({ repos }, spaceIds) => websiteRepos(repos).domains.countInProduction(spaceIds),
  },
  hosts: SITE_HOST_SOURCE,
});

/** The website's data providers. */
export const websiteData = [designs, domains];
