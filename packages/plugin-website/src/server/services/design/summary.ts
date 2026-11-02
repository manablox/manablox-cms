import type { ResolvedScope } from '@manablox/core';
import { defaultSiteSettings, defaultTheme } from '@manablox/site';
import { type SiteDesignKindName, WEBSITE } from '../../../shared/site.js';
import type { SiteDesignRow } from '../../db/index.js';
import { websiteRepos } from '../../db/index.js';
import { DEFAULT_KEY, type DesignContext } from './context.js';

/**
 * `generated`: no stored design, rendered from the generators; `unpublished`: stored, never
 * published; `changed`: the draft differs from the live copy; `published`: both agree.
 */
type SiteDesignStatus = 'generated' | 'unpublished' | 'changed' | 'published';

/** One design of the overview, stored or implied by the space's types and menus. */
export interface SiteDesignSummary {
  kind: SiteDesignKindName;
  key: string;
  label: string;
  status: SiteDesignStatus;
  /** `null` while generated. */
  id: string | null;
  version: number | null;
  publishedAt: Date | null;
  updatedAt: Date | null;
  /** Stored for a block or content type that no longer exists. */
  orphaned: boolean;
}

/** A design with its draft; `data` is the default for theme and site, else `null` while generated. */
export interface SiteDesignDetail {
  kind: SiteDesignKindName;
  key: string;
  status: SiteDesignStatus;
  design: SiteDesignRow | null;
  data: unknown;
}

const KIND_LABELS: Record<SiteDesignKindName, string> = {
  theme: 'Theme',
  block: 'Block',
  page: 'Page',
  layout: 'Layout',
  menu: 'Menu',
  site: 'Site',
};

/** Every design the space has or implies, with its status. */
export async function listDesigns(
  ctx: DesignContext,
  scope: string | ResolvedScope,
): Promise<SiteDesignSummary[]> {
  const [rows, menus] = await Promise.all([
    websiteRepos(ctx.repos).designs.listBySpace(scope),
    ctx.repos.menus.listBySpace(scope),
  ]);
  const implied: Array<{ kind: SiteDesignKindName; key: string; label: string }> = [
    { kind: 'theme', key: DEFAULT_KEY, label: 'Theme' },
    { kind: 'site', key: DEFAULT_KEY, label: 'Site' },
    { kind: 'layout', key: DEFAULT_KEY, label: 'Default layout' },
  ];
  for (const type of ctx.manablox.contentTypes.forSpace(scope)) {
    if (type.isSystem) continue;
    if (type.kind === 'block') implied.push({ kind: 'block', key: type.id, label: type.label });
    if (type.kind === 'content') implied.push({ kind: 'page', key: type.id, label: type.label });
  }
  for (const menu of menus) implied.push({ kind: 'menu', key: menu.machineName, label: menu.name });

  const stored = new Map(rows.map((row) => [`${row.kind}:${row.key}`, row]));
  const out: SiteDesignSummary[] = implied.map((entry) => {
    const row = stored.get(`${entry.kind}:${entry.key}`) ?? null;
    stored.delete(`${entry.kind}:${entry.key}`);
    return summary(entry.kind, entry.key, row?.name || entry.label, row, false);
  });
  for (const row of stored.values()) {
    // Extra layouts and menu presets are expected; designs of deleted types are orphans.
    const orphaned = row.kind === 'block' || row.kind === 'page';
    out.push(summary(row.kind, row.key, row.name || row.key, row, orphaned));
  }
  return out;
}

/** One design; generated when nothing is stored. */
export async function designDetail(
  ctx: DesignContext,
  scope: string | ResolvedScope,
  kind: SiteDesignKindName,
  key: string,
): Promise<SiteDesignDetail> {
  const row = await websiteRepos(ctx.repos).designs.find(scope, kind, key);
  return {
    kind,
    key,
    status: designStatus(row),
    design: row,
    data: row ? row.draft : (codeDesign(ctx, kind, key) ?? generatedData(kind)),
  };
}

export function designStatus(row: SiteDesignRow | null): SiteDesignStatus {
  if (!row) return 'generated';
  if (row.publishedVersion === null) return 'unpublished';
  return row.publishedVersion === row.version ? 'published' : 'changed';
}

/** The audit target of a design: its name, else kind and key. */
export function designTarget(row: SiteDesignRow): {
  id: string;
  spaceId: string;
  environmentId: string;
  label: string;
} {
  return {
    id: row.id,
    spaceId: row.spaceId,
    environmentId: row.environmentId,
    label: row.name || `${KIND_LABELS[row.kind]} ${row.key}`,
  };
}

function summary(
  kind: SiteDesignKindName,
  key: string,
  label: string,
  row: SiteDesignRow | null,
  orphaned: boolean,
): SiteDesignSummary {
  return {
    kind,
    key,
    label,
    status: designStatus(row),
    id: row?.id ?? null,
    version: row?.version ?? null,
    publishedAt: row?.publishedAt ?? null,
    updatedAt: row?.updatedAt ?? null,
    orphaned,
  };
}

/** The design a code block type ships, used while the space stores none. */
function codeDesign(ctx: DesignContext, kind: SiteDesignKindName, key: string): unknown {
  if (kind !== 'block') return null;
  return ctx.manablox.contentTypes.tryGet(key)?.plugins?.[WEBSITE] ?? null;
}

/** The data a generated design starts from where it needs no content model. */
function generatedData(kind: SiteDesignKindName): unknown {
  if (kind === 'theme') return defaultTheme();
  if (kind === 'site') return defaultSiteSettings();
  return null;
}
