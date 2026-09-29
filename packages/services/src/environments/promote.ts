import { type ContentTypeKind, ManabloxError } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import {
  documentMetric,
  type Repositories,
  TOTAL_PERIOD,
  type TotalMetric,
  type TransactionRepositories,
} from '@manablox/db';
import { SpaceNominations } from '../nominations.js';
import type { EnvironmentData } from './data.js';
import type { PromotePlan, ProviderPlan } from './plan.js';

/**
 * Core's table groups a promote writes, each in its own transaction, in this order; data
 * providers' groups run after them.
 */
export const PROMOTE_GROUPS = [
  'contentTypes',
  'templates',
  'contents',
  'menus',
  'redirects',
] as const;
type CorePromoteGroup = (typeof PROMOTE_GROUPS)[number];

/** A core group or a data provider's key. */
export type PromoteGroup = CorePromoteGroup | (string & Record<never, never>);

export interface PromoteGroupResult {
  group: PromoteGroup;
  /** `skipped` after an earlier group failed. */
  status: 'applied' | 'failed' | 'skipped';
  /** The error key of a failed group. */
  error: string | null;
}

export interface PromoteContext {
  manablox: Manablox;
  spaceId: string;
  productionId: string;
  stagingId: string;
  /** The staging machine name, e.g. for version notes. */
  environment: string;
  plan: PromotePlan;
  production: EnvironmentData;
  /** The kind of a content type id that is not in the plan, e.g. a code type. */
  kindOf: (typeId: string) => ContentTypeKind | undefined;
}

/** The groups a promote of `plan` runs. */
export function promoteGroups(plan: Pick<PromotePlan, 'mode' | 'plugins'>): PromoteGroup[] {
  return [
    ...PROMOTE_GROUPS.filter((group) =>
      plan.mode === 'full' ? group !== 'templates' : group !== 'contents',
    ),
    ...plan.plugins.map((entry) => entry.key),
  ];
}

/**
 * Runs the groups one transaction each. A failed group rolls back alone and the rest are
 * skipped; the earlier ones stay.
 */
export async function applyPromote(
  repos: Repositories,
  context: PromoteContext,
): Promise<PromoteGroupResult[]> {
  const results: PromoteGroupResult[] = [];
  let failed = false;
  for (const group of promoteGroups(context.plan)) {
    if (failed) {
      results.push({ group, status: 'skipped', error: null });
      continue;
    }
    const entry = context.plan.plugins.find((plugin) => plugin.key === group);
    try {
      await repos.transaction((tx) =>
        entry ? applyProvider(tx, context, entry) : APPLY[group as CorePromoteGroup](tx, context),
      );
      results.push({ group, status: 'applied', error: null });
    } catch (error) {
      failed = true;
      results.push({
        group,
        status: 'failed',
        error: ManabloxError.is(error) ? error.key : 'environment.promote.failed',
      });
    }
  }
  return results;
}

type Apply = (tx: TransactionRepositories, context: PromoteContext) => Promise<void>;

async function applyProvider(
  tx: TransactionRepositories,
  context: PromoteContext,
  entry: ProviderPlan,
): Promise<void> {
  const { manablox, spaceId, stagingId, productionId, environment, plan } = context;
  // The plan holds only providers that promote.
  await entry.handler.promote?.({
    manablox,
    repos: tx,
    spaceId,
    stagingId,
    productionId,
    environment,
    mode: plan.mode,
    upsert: entry.upsert,
    remove: entry.remove,
    production: entry.production,
    ids: plan.map,
  });
}

const TYPE_COLUMNS = [
  'name',
  'label',
  'description',
  'icon',
  'kind',
  'hasSlug',
  'isPublishable',
  'isVisibleInTree',
  'canBeVisibleInMenu',
  'requiresApproval',
  'fields',
] as const;

const APPLY: Record<CorePromoteGroup, Apply> = {
  async contentTypes(tx, { plan, production, productionId, spaceId }) {
    const rows = tx.environmentRows;
    const existing = new Set(production.contentTypes.map((type) => type.id));
    // Removed first, so a name can move to another type.
    if (plan.mode === 'config') {
      const counts = await rows.countByType(productionId);
      await removeTypes(
        tx,
        plan.types.unmatched.filter((type) => !counts.get(type.id)).map((type) => type.id),
      );
    }
    for (const type of plan.types.upsert.filter((row) => existing.has(row.id))) {
      await rows.update('contentTypes', type.id, {
        ...pick(type, TYPE_COLUMNS),
        updatedAt: new Date(),
      });
    }
    const added = plan.types.upsert.filter((row) => !existing.has(row.id));
    await rows.insert('contentTypes', added);
    // Grants roles hold on a new type's staging id follow it into production.
    const addedIds = new Set(added.map((row) => row.id));
    for (const [from, to] of plan.map.ids) {
      if (addedIds.has(to)) await tx.roles.copyContentTypeGrants(spaceId, from, to);
    }
  },

  async templates(tx, context) {
    await replaceDocuments(tx, context);
  },

  async contents(tx, context) {
    const { plan, production, spaceId } = context;
    const before = totals(production.contents, context);
    await replaceDocuments(tx, context);
    const after = totals(plan.documents.contents, context);
    await tx.usageCounters.incrementMany(
      [...new Set([...before.keys(), ...after.keys()])].map((metric) => ({
        scope: { kind: 'space' as const, id: spaceId },
        metric,
        period: TOTAL_PERIOD,
        delta: (after.get(metric) ?? 0) - (before.get(metric) ?? 0),
      })),
    );
    // Types no document uses any more.
    const used = new Set(plan.documents.contents.map((row) => row.typeId));
    await removeTypes(
      tx,
      plan.types.unmatched.filter((type) => !used.has(type.id)).map((type) => type.id),
    );
    // Staging's nominations; production's own where staging has none and its document is
    // still there.
    const nominations = await SpaceNominations.load(context.manablox, tx, spaceId);
    if (nominations) {
      const ids = new Set(plan.documents.contents.map((row) => row.id));
      for (const nomination of nominations.list) {
        const own = nominations.get(context.stagingId, nomination);
        const live = nominations.get(null, nomination);
        const staged = own ? plan.map.id(own) : live;
        nominations.set(null, nomination, staged && ids.has(staged) ? staged : null);
      }
      await nominations.save(tx);
    }
  },

  async menus(tx, { plan, production }) {
    const rows = tx.environmentRows;
    const existing = new Set(production.menus.map((menu) => menu.id));
    await rows.remove(
      'menus',
      plan.menus.remove.map((menu) => menu.id),
    );
    for (const menu of plan.menus.upsert.filter((row) => existing.has(row.id))) {
      await rows.update('menus', menu.id, {
        name: menu.name,
        machineName: menu.machineName,
        description: menu.description,
        updatedAt: new Date(),
      });
    }
    await rows.insert(
      'menus',
      plan.menus.upsert.filter((row) => !existing.has(row.id)),
    );
    if (plan.mode === 'full') {
      await rows.removeBy(
        'menuItems',
        'menuId',
        plan.menus.upsert.map((menu) => menu.id),
      );
      await rows.insert('menuItems', plan.menus.items);
    }
  },

  async redirects(tx, { plan }) {
    await tx.environmentRows.remove(
      'redirects',
      plan.redirects.remove.map((row) => row.id),
    );
    await tx.environmentRows.insert('redirects', plan.redirects.upsert);
  },
};

/**
 * Replaces production's documents of the plan (templates, or every document) with the
 * plan's. Only rows that differ are written: a document, live copy or version the same in
 * both stays, with its approval requests; a document replaced or removed loses them with
 * the delete. Asset usages and tags are replaced whole.
 */
async function replaceDocuments(
  tx: TransactionRepositories,
  { plan, production }: PromoteContext,
): Promise<void> {
  const rows = tx.environmentRows;
  const { contents, published, versions, contentTags, assetUsages } = plan.documents;
  await rows.removeBy('contentTags', 'localizationId', [
    ...new Set(production.contents.map((row) => row.localizationId)),
  ]);

  const versionChange = changedRows(production.versions, versions);
  await rows.remove('contentVersions', versionChange.remove);
  const publishedChange = changedRows(production.published, published);
  await rows.remove('publishedContents', publishedChange.remove);
  const contentChange = changedRows(production.contents, contents);
  await rows.removeBy(
    'assetUsages',
    'contentId',
    production.contents.map((row) => row.id),
  );
  await rows.remove('contents', contentChange.remove);

  await rows.insert('contents', contentChange.write);
  await rows.insert('publishedContents', publishedChange.write);
  await rows.insert('contentVersions', versionChange.write);
  await rows.insert('contentTags', contentTags);
  await rows.insert('assetUsages', assetUsages);
}

/**
 * What turns `live` into `next`, by id: the ids to delete (gone or different) and the rows
 * to insert (new or different); rows the same in both stay.
 */
function changedRows<T extends { id: string }>(
  live: readonly T[],
  next: readonly T[],
): { remove: string[]; write: T[] } {
  const before = new Map(live.map((row) => [row.id, row]));
  const write: T[] = [];
  const keep = new Set<string>();
  for (const row of next) {
    const current = before.get(row.id);
    if (current && sameRow(current, row)) keep.add(row.id);
    else write.push(row);
  }
  return { remove: live.map((row) => row.id).filter((id) => !keep.has(id)), write };
}

/** Whether two rows hold the same values; generated columns aside. */
function sameRow(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => !GENERATED_COLUMNS.has(key));
  if (keys.length !== Object.keys(right).filter((key) => !GENERATED_COLUMNS.has(key)).length) {
    return false;
  }
  return keys.every((key) => key in right && sameValue(left[key], right[key]));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => key in right && sameValue(left[key], right[key]))
  );
}

/** Columns the database computes; a copy never carries them. */
const GENERATED_COLUMNS = new Set(['search']);

async function removeTypes(tx: TransactionRepositories, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.environmentRows.remove('contentTypes', ids);
  for (const id of ids) await tx.roles.pruneContentType(id);
}

/** Documents per total counter. */
function totals(
  rows: Array<{ typeId: string }>,
  context: PromoteContext,
): Map<TotalMetric, number> {
  const kinds = new Map<string, ContentTypeKind>();
  for (const type of [...context.production.contentTypes, ...context.plan.types.upsert]) {
    kinds.set(type.id, type.kind);
  }
  const out = new Map<TotalMetric, number>();
  for (const row of rows) {
    const metric = documentMetric(kinds.get(row.typeId) ?? context.kindOf(row.typeId));
    if (metric) out.set(metric, (out.get(metric) ?? 0) + 1);
  }
  return out;
}

function pick<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = row[key];
  return out;
}
