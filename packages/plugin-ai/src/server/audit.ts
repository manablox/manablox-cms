import { type AuditSink, auditor, type PluginAudit } from '@manablox/core';
import type { SpaceRow } from '@manablox/db';
import type { AiProviderRow } from './db/index.js';

/** The audit entities of providers, generations and the space's AI settings. */
const PROVIDER_ENTITY = 'ai.provider';
const GENERATION_ENTITY = 'ai.generation';
const SETTINGS_ENTITY = 'ai.settings';

/** Providers, generations and the space's AI settings in the activity log. */
export const aiAudit: PluginAudit = {
  entities: [PROVIDER_ENTITY, GENERATION_ENTITY, SETTINGS_ENTITY],
};

/** Entries on providers, named by `label`; never with the key. */
export const providerAuditor = (sink: AuditSink, label: (row: AiProviderRow) => string) =>
  auditor(sink, PROVIDER_ENTITY, label);

/** A generation as it starts, named by its provider and capability; it has no row yet. */
export const generationAuditor = (sink: AuditSink) =>
  auditor(
    sink,
    GENERATION_ENTITY,
    (generation: { id: null; spaceId: string; label: string }) => generation.label,
  );

/** Entries on the space's AI settings, named by the space. */
export const settingsAuditor = (sink: AuditSink) =>
  auditor(sink, SETTINGS_ENTITY, (space: SpaceRow) => space.name, { spaceId: (space) => space.id });
