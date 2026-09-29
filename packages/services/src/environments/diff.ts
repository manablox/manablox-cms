import { canonicalJson, type FieldDefinition } from '@manablox/core';
import type { Repositories } from '@manablox/db';
import type { EnvironmentData } from './data.js';
import type { PromoteMode, PromotePlan } from './plan.js';

export type DiffStatus = 'added' | 'changed' | 'removed';

/** One field of a content type that differs between staging and production. */
export interface FieldDiff {
  name: string;
  label: string;
  /** `retyped`: the field type changed. */
  status: DiffStatus | 'retyped';
  /** The field type before and after. */
  from: string | null;
  to: string | null;
  /** Production documents holding a value for the field; 0 for added fields. */
  documents: number;
}

/** One content type that differs; `kept` is a removed type production documents still use. */
export interface ContentTypeDiff {
  id: string;
  name: string;
  label: string;
  status: DiffStatus | 'kept';
  /** Production documents of the type. */
  documents: number;
  fields: FieldDiff[];
}

/** Core's kinds; data providers' lines use their key and come after them. */
export const DIFF_KINDS = ['templates', 'contents', 'menus', 'redirects'] as const;

/** A core kind or a data provider's key. */
export type DiffKind = (typeof DIFF_KINDS)[number] | (string & Record<never, never>);

/** Items listed per kind; the counts stay complete. */
export const DIFF_ITEMS_MAX = 100;

export interface KindDiff {
  kind: DiffKind;
  added: number;
  changed: number;
  removed: number;
  items: Array<{ status: DiffStatus; id: string; label: string }>;
  /** More items differ than `items` lists. */
  truncated: boolean;
}

/** What a promote changes in production. */
export interface EnvironmentDiff {
  environment: string;
  mode: PromoteMode;
  contentTypes: ContentTypeDiff[];
  changes: KindDiff[];
  /** Config only: fields removed or retyped while production documents hold values for them. */
  breaking: boolean;
  /** The promote needs `confirm`: when breaking, and always for a full promote. */
  confirmRequired: boolean;
}

/** Compares a plan against production's rows. */
export async function diffPlan(
  repos: Repositories,
  plan: PromotePlan,
  production: EnvironmentData,
  productionId: string,
  environment: string,
): Promise<EnvironmentDiff> {
  const contentTypes = await diffContentTypes(repos, plan, production, productionId);
  const changes: KindDiff[] = [
    diffDocuments(plan, production),
    diffMenus(plan, production),
    diffRedirects(plan, production),
    ...plan.plugins.map((entry) =>
      diffRows(
        entry.key,
        entry.upsert,
        entry.production,
        (row) => entry.handler.describe?.(row).label ?? row.id,
        (row) => entry.handler.describe?.(row).value ?? null,
        entry.remove,
      ),
    ),
  ];

  const breaking =
    plan.mode === 'config' &&
    contentTypes.some((type) =>
      type.fields.some(
        (field) =>
          (field.status === 'removed' || field.status === 'retyped') && field.documents > 0,
      ),
    );
  return {
    environment,
    mode: plan.mode,
    contentTypes,
    changes,
    breaking,
    confirmRequired: breaking || plan.mode === 'full',
  };
}

/** Added, changed and removed types, with production's documents counted per type and field. */
async function diffContentTypes(
  repos: Repositories,
  plan: PromotePlan,
  production: EnvironmentData,
  productionId: string,
): Promise<ContentTypeDiff[]> {
  const counts = await repos.environmentRows.countByType(productionId);
  const contentTypes: ContentTypeDiff[] = [];
  const before = new Map(production.contentTypes.map((type) => [type.id, type]));

  for (const type of plan.types.upsert) {
    const previous = before.get(type.id);
    const documents = counts.get(type.id) ?? 0;
    if (!previous) {
      contentTypes.push({
        id: type.id,
        name: type.name,
        label: type.label,
        status: 'added',
        documents: 0,
        fields: type.fields.map((field) => fieldDiff(field, 'added', null, field.type)),
      });
      continue;
    }
    const fields = compareFields(previous.fields, type.fields);
    const counted = fields.filter((field) => field.status !== 'added').map((field) => field.name);
    if (documents > 0 && counted.length > 0) {
      const values = await repos.environmentRows.countFieldValues(productionId, type.id, counted);
      for (const field of fields) field.documents = values.get(field.name) ?? 0;
    }
    const { fields: _a, updatedAt: _b, createdAt: _c, ...rest } = type;
    const { fields: _d, updatedAt: _e, createdAt: _f, ...was } = previous;
    if (fields.length > 0 || !same(rest, was)) {
      contentTypes.push({
        id: type.id,
        name: type.name,
        label: type.label,
        status: 'changed',
        documents,
        fields,
      });
    }
  }
  for (const type of plan.types.unmatched) {
    const documents = counts.get(type.id) ?? 0;
    contentTypes.push({
      id: type.id,
      name: type.name,
      label: type.label,
      // A full promote replaces the documents, so the type goes.
      status: documents > 0 && plan.mode === 'config' ? 'kept' : 'removed',
      documents,
      fields: [],
    });
  }
  return contentTypes;
}

/** Documents in a full promote, templates in a config promote; published values included. */
function diffDocuments(plan: PromotePlan, production: EnvironmentData): KindDiff {
  const publishedOf = (rows: Array<{ id: string; fields: unknown; title: string }>) =>
    new Map(rows.map((row) => [row.id, { title: row.title, fields: row.fields }]));
  const stagedPublished = publishedOf(plan.documents.published);
  const livePublished = publishedOf(production.published);
  return diffRows(
    plan.mode === 'full' ? 'contents' : 'templates',
    plan.documents.contents,
    production.contents,
    (row) => row.title,
    (row, published) => ({
      typeId: row.typeId,
      locale: row.locale,
      parentId: row.parentId,
      position: row.position,
      title: row.title,
      slug: row.slug,
      status: row.status,
      fields: row.fields,
      published: (published ? stagedPublished : livePublished).get(row.id) ?? null,
    }),
  );
}

function diffMenus(plan: PromotePlan, production: EnvironmentData): KindDiff {
  const itemsOf = (menuId: string, items: typeof plan.menus.items) =>
    items
      .filter((item) => item.menuId === menuId)
      .map(({ id, parentId, position, localizationId, label, url, target }) => ({
        id,
        parentId,
        position,
        localizationId,
        label,
        url,
        target,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  return diffRows(
    'menus',
    plan.menus.upsert,
    production.menus,
    (row) => row.name,
    (row, staged) => ({
      name: row.name,
      machineName: row.machineName,
      description: row.description,
      // Entries move in a full promote only.
      ...(plan.mode === 'full'
        ? { items: itemsOf(row.id, staged ? plan.menus.items : production.menuItems) }
        : {}),
    }),
  );
}

function diffRedirects(plan: PromotePlan, production: EnvironmentData): KindDiff {
  return diffRows(
    'redirects',
    plan.redirects.upsert,
    production.redirects,
    (row) => row.fromPath,
    (row) => ({
      locale: row.locale,
      fromPath: row.fromPath,
      toPath: row.toPath,
      toContentId: row.toContentId,
      status: row.status,
    }),
    plan.redirects.remove.filter(
      (row) => !plan.redirects.upsert.some((staged) => staged.id === row.id),
    ),
  );
}

function fieldDiff(
  field: FieldDefinition,
  status: FieldDiff['status'],
  from: string | null,
  to: string | null,
): FieldDiff {
  return { name: field.name, label: field.label, status, from, to, documents: 0 };
}

/** Fields by name, which never changes on a stored type. */
function compareFields(before: FieldDefinition[], after: FieldDefinition[]): FieldDiff[] {
  const out: FieldDiff[] = [];
  const previous = new Map(before.map((field) => [field.name, field]));
  const next = new Map(after.map((field) => [field.name, field]));
  for (const field of after) {
    const was = previous.get(field.name);
    if (!was) out.push(fieldDiff(field, 'added', null, field.type));
    else if (was.type !== field.type) out.push(fieldDiff(field, 'retyped', was.type, field.type));
    else if (!same(was, field)) out.push(fieldDiff(field, 'changed', was.type, field.type));
  }
  for (const field of before) {
    if (!next.has(field.name)) out.push(fieldDiff(field, 'removed', field.type, null));
  }
  return out;
}

/** Added, changed and removed rows by id; `removed` defaults to production rows not staged. */
function diffRows<T extends { id: string }>(
  kind: DiffKind,
  staged: T[],
  live: T[],
  label: (row: T) => string,
  significant: (row: T, staged: boolean) => unknown,
  removed?: T[],
): KindDiff {
  const out: KindDiff = { kind, added: 0, changed: 0, removed: 0, items: [], truncated: false };
  const push = (status: DiffStatus, row: T) => {
    out[status]++;
    if (out.items.length < DIFF_ITEMS_MAX)
      out.items.push({ status, id: row.id, label: label(row) });
    else out.truncated = true;
  };
  const before = new Map(live.map((row) => [row.id, row]));
  const ids = new Set(staged.map((row) => row.id));
  for (const row of staged) {
    const was = before.get(row.id);
    if (!was) push('added', row);
    else if (!same(significant(row, true), significant(was, false))) push('changed', row);
  }
  for (const row of removed ?? live.filter((entry) => !ids.has(entry.id))) push('removed', row);
  return out;
}

/** Deep equality through JSON with sorted keys. */
export function same(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
