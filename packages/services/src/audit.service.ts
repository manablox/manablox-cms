import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_ACTOR_KIND_LABELS,
  AUDIT_TARGET_KIND_LABELS,
  type AuditCatalog,
  type AuditEntry,
  type AuditTargetKind,
  type CoreAuditActorKind,
  type CoreAuditTargetKind,
  ManabloxError,
  pluginAuditActorKinds,
  pluginAuditEntities,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type {
  AuditEntryRow,
  AuditFilter,
  AuditSort,
  AuditVerification,
  Paginated,
  Pagination,
  Repositories,
} from '@manablox/db';
import { auditRetention, retentionCutoff, spaceAuditRetention } from './retention.js';

export type { AuditCatalog, AuditEntry, AuditFilter, AuditSort, AuditVerification };

/** A label map as `{ id, label }` pairs in key order. */
function labelled<K extends string>(labels: Record<K, string>): Array<{ id: K; label: string }> {
  return (Object.entries(labels) as Array<[K, string]>).map(([id, label]) => ({ id, label }));
}

/**
 * Reads the audit log with space checks, leaving out entries past `retention.auditDays`;
 * writes go through `repos.audit.record`.
 */
export class AuditService {
  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
  ) {}

  /** Core vocabulary, then the loaded plugins' entities, labelled by their key. */
  catalog(): AuditCatalog {
    return {
      actions: AUDIT_ACTIONS.map((id) => ({ id, label: AUDIT_ACTION_LABELS[id] })),
      actorKinds: [
        ...labelled<CoreAuditActorKind>(AUDIT_ACTOR_KIND_LABELS),
        ...pluginAuditActorKinds().map((key) => ({ id: key, label: key })),
      ],
      targetKinds: [
        ...labelled<CoreAuditTargetKind>(AUDIT_TARGET_KIND_LABELS),
        ...pluginAuditEntities().map((key) => ({ id: key, label: key })),
      ],
    };
  }

  /** A space's entries; the filter cannot override the space. */
  async list(
    spaceId: string,
    filter: Omit<AuditFilter, 'spaceId' | 'retention'>,
    sort?: AuditSort,
    pagination?: Pagination,
  ): Promise<Paginated<AuditEntry>> {
    const retention = await spaceAuditRetention(this.manablox, spaceId);
    return this.page({ ...filter, spaceId, retention }, sort, pagination);
  }

  /** Instance-wide or spaceless entries, for superadmins. */
  async listInstance(
    filter: Omit<AuditFilter, 'retention'>,
    sort?: AuditSort,
    pagination?: Pagination,
  ): Promise<Paginated<AuditEntry>> {
    const retention =
      filter.spaceId === null
        ? await spaceAuditRetention(this.manablox, null)
        : await auditRetention(this.manablox, this.repos);
    return this.page({ ...filter, retention }, sort, pagination);
  }

  /** One entry; another space's is not found. */
  async get(spaceId: string | null, id: string): Promise<AuditEntry> {
    const row = await this.repos.audit.findById(id);
    if (!row || (spaceId !== null && row.spaceId !== spaceId) || (await this.expired(row))) {
      throw ManabloxError.notFound('audit.notFound', { id });
    }
    return toEntry(row);
  }

  /** A page of the space's entries for one target, newest first. */
  async forTarget(
    spaceId: string,
    targetKind: AuditTargetKind,
    targetId: string,
    pagination?: Pagination,
  ): Promise<Paginated<AuditEntry>> {
    const page = await this.repos.audit.pageByTarget(
      { kind: targetKind, id: targetId, spaceId },
      pagination,
      await spaceAuditRetention(this.manablox, spaceId),
    );
    return { ...page, items: page.items.map(toEntry) };
  }

  /** Verifies the whole chain; the result is itself audited. */
  async verify(): Promise<AuditVerification> {
    const result = await this.repos.audit.verify();
    if (result.ok) this.manablox.logger.info({ checked: result.checked }, 'audit chain verified');
    else this.manablox.logger.error(result, 'audit chain broken');
    return result;
  }

  /** Whether the entry is past its scope's retention window. */
  private async expired(row: AuditEntryRow): Promise<boolean> {
    const days = (await this.manablox.controls.resolved(row.spaceId)).retention.auditDays;
    const cutoff = retentionCutoff(days);
    return cutoff !== null && row.at < cutoff;
  }

  private async page(
    filter: AuditFilter,
    sort?: AuditSort,
    pagination?: Pagination,
  ): Promise<Paginated<AuditEntry>> {
    const page = await this.repos.audit.page(filter, sort, pagination);
    return { ...page, items: page.items.map(toEntry) };
  }
}

function toEntry(row: AuditEntryRow): AuditEntry {
  return {
    id: row.id,
    seq: row.seq,
    at: row.at,
    spaceId: row.spaceId,
    actorKind: row.actorKind,
    actorId: row.actorId,
    actorLabel: row.actorLabel,
    actorDetail: row.actorDetail,
    action: row.action,
    targetKind: row.targetKind,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    changes: row.changes,
    meta: row.meta,
    prevHash: row.prevHash,
    hash: row.hash,
  };
}
