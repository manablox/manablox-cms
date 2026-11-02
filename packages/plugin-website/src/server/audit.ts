import { type AuditSink, auditor, type PluginAudit } from '@manablox/core';
import type { SpaceRow } from '@manablox/db';
import type { SiteDomainRow } from './db/index.js';

/** The audit entities of designs, domains and the website settings. */
const DESIGN_ENTITY = 'website.design';
const DOMAIN_ENTITY = 'website.domain';
const SETTINGS_ENTITY = 'website.settings';

/** Designs, domains and the website settings in the activity log. */
export const websiteAudit: PluginAudit = {
  entities: [DESIGN_ENTITY, DOMAIN_ENTITY, SETTINGS_ENTITY],
};

/** Entries on designs (themes included), named by their label. */
export const designAuditor = (sink: AuditSink) =>
  auditor(
    sink,
    DESIGN_ENTITY,
    (row: { id: string | null; spaceId: string; label: string }) => row.label,
  );

/** Entries on domains, with their locale. */
export const domainAuditor = (sink: AuditSink) =>
  auditor(sink, DOMAIN_ENTITY, (row: SiteDomainRow) => row.hostname, {
    meta: (row) => ({ locale: row.locale }),
  });

/** Entries on the space's website settings, named by the space. */
export const settingsAuditor = (sink: AuditSink) =>
  auditor(sink, SETTINGS_ENTITY, (space: SpaceRow) => space.name, { spaceId: (space) => space.id });
