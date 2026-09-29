import { PRODUCTION_ENVIRONMENT } from '@manablox/core';
import type { FeatureState } from '../../lib/features';
import { formatDateTime, plural } from '../../lib/format';
import type { Environment, EnvironmentDiff, EnvironmentMode, PromoteResult } from './queries';

/** How the environment switcher shows. */
export type SwitcherState = 'hidden' | 'locked' | 'select';

/** Hidden with the feature hidden or while production is the only one; a lock while locked. */
export function switcherState(
  feature: FeatureState,
  environments: readonly Pick<Environment, 'machineName'>[] | undefined,
): SwitcherState {
  if (feature.hidden) return 'hidden';
  if (feature.locked) return 'locked';
  return (environments?.length ?? 0) > 1 ? 'select' : 'hidden';
}

export const isProduction = (machineName: string): boolean =>
  machineName === PRODUCTION_ENVIRONMENT;

/** What each copy mode takes along, for create and promote. */
export const MODES: Record<EnvironmentMode, { label: string; create: string; promote: string }> = {
  config: {
    label: 'Config only',
    create:
      'Content types, templates, menus without their entries, redirects, and what plugins keep, switched off where it would act on its own. Start with empty content.',
    promote:
      "Content types, templates, menu structure, redirects and what plugins keep replace production's. Production's content stays; values of removed fields stay stored.",
  },
  full: {
    label: 'Config and content',
    create:
      'Everything config only copies, plus every document with its published state, menu entries and redirects. Assets are shared, not copied.',
    promote:
      "Replaces production's config and content with this environment's. Production keeps its domains and API hosts.",
  },
};

/** One environment as the settings list shows it. */
export interface EnvironmentRow {
  id: string;
  name: string;
  machineName: string;
  kind: string;
  production: boolean;
  /** `Copied from Production (config only)`, or empty for production. */
  origin: string;
  created: string;
}

export function environmentRows(list: readonly Environment[]): EnvironmentRow[] {
  const byId = new Map(list.map((environment) => [environment.id, environment]));
  return list.map((environment) => {
    const source = environment.createdFrom ? byId.get(environment.createdFrom) : undefined;
    const mode = environment.createdMode
      ? MODES[environment.createdMode].label.toLowerCase()
      : null;
    const origin =
      environment.kind === 'production'
        ? ''
        : `Copied from ${source?.name ?? 'a deleted environment'}${mode ? ` (${mode})` : ''}`;
    return {
      id: environment.id,
      name: environment.name,
      machineName: environment.machineName,
      kind: environment.kind,
      production: environment.kind === 'production',
      origin,
      created: formatDateTime(environment.createdAt),
    };
  });
}

type DiffStatus = 'added' | 'changed' | 'removed' | 'retyped' | 'kept';

const STATUS_TEXT: Record<DiffStatus, string> = {
  added: 'new',
  changed: 'changed',
  removed: 'removed',
  retyped: 'type changed',
  kept: 'removed, kept',
};

const STATUS_TONE: Record<DiffStatus, string> = {
  added: 'mb-badge-ok',
  changed: 'mb-badge',
  removed: 'mb-badge-danger',
  retyped: 'mb-badge-warn',
  kept: 'mb-badge-warn',
};

const KIND_LABELS: Record<string, string> = {
  contentTypes: 'Content types',
  templates: 'Templates',
  contents: 'Content',
  menus: 'Menus',
  redirects: 'Redirects',
};

const pluginKindLabels = new Map<string, string>();

/** Names plugins give their diff kinds. */
export function registerDiffKinds(labels: Record<string, string>): void {
  for (const [kind, label] of Object.entries(labels)) pluginKindLabels.set(kind, label);
}

export const diffKindLabel = (kind: string): string =>
  KIND_LABELS[kind] ?? pluginKindLabels.get(kind) ?? kind;

interface DiffBadge {
  text: string;
  tone: string;
}

const badge = (status: DiffStatus): DiffBadge => ({
  text: STATUS_TEXT[status],
  tone: STATUS_TONE[status],
});

interface FieldChange {
  name: string;
  label: string;
  badge: DiffBadge;
  /** `text -> number` for a retyped field. */
  types: string | null;
  /** `12 documents hold a value`, empty when none. */
  documents: string;
  /** Production values the change leaves behind. */
  breaking: boolean;
}

interface TypeChange {
  id: string;
  label: string;
  name: string;
  badge: DiffBadge;
  documents: string;
  fields: FieldChange[];
}

interface KindChange {
  kind: string;
  label: string;
  summary: string;
  items: { id: string; label: string; badge: DiffBadge }[];
  /** `and more`, when the server listed only some. */
  more: boolean;
}

/** A diff laid out for reading: changed types with their fields, then the other kinds. */
export interface DiffView {
  types: TypeChange[];
  kinds: KindChange[];
  empty: boolean;
  breaking: boolean;
  confirmRequired: boolean;
}

const holding = (count: number): string =>
  count > 0
    ? `${plural(count, 'production document')} ${count === 1 ? 'holds' : 'hold'} a value`
    : '';

/** `2 new, 1 changed, 3 removed`; only the non-zero counts. */
function countSummary(counts: { added: number; changed: number; removed: number }): string {
  return [
    counts.added ? `${counts.added} new` : '',
    counts.changed ? `${counts.changed} changed` : '',
    counts.removed ? `${counts.removed} removed` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

export function diffView(diff: EnvironmentDiff): DiffView {
  const types = diff.contentTypes.map<TypeChange>((type) => ({
    id: type.id,
    label: type.label,
    name: type.name,
    badge: badge(type.status),
    documents: type.documents > 0 ? `used by ${plural(type.documents, 'production document')}` : '',
    fields: type.fields.map((field) => ({
      name: field.name,
      label: field.label,
      badge: badge(field.status),
      types: field.status === 'retyped' ? `${field.from ?? '?'} -> ${field.to ?? '?'}` : null,
      documents: field.status === 'added' ? '' : holding(field.documents),
      breaking: (field.status === 'removed' || field.status === 'retyped') && field.documents > 0,
    })),
  }));
  const kinds = diff.changes
    .filter((change) => change.added + change.changed + change.removed > 0)
    .map<KindChange>((change) => ({
      kind: change.kind,
      label: diffKindLabel(change.kind),
      summary: countSummary(change),
      items: change.items.map((item) => ({
        id: item.id,
        label: item.label,
        badge: badge(item.status),
      })),
      more: change.truncated,
    }));
  return {
    types,
    kinds,
    empty: types.length === 0 && kinds.length === 0,
    breaking: diff.breaking,
    confirmRequired: diff.confirmRequired,
  };
}

/** What has to be typed before a promote runs; `null` when a click is enough. */
export const promoteConfirmText = (
  diff: Pick<EnvironmentDiff, 'confirmRequired'>,
  machineName: string,
): string | null => (diff.confirmRequired ? machineName : null);

/** Whether the promote may run with `typed` in the confirmation field. */
export function promoteReady(
  diff: Pick<EnvironmentDiff, 'confirmRequired'> | undefined,
  machineName: string,
  typed: string,
): boolean {
  if (!diff) return false;
  const required = promoteConfirmText(diff, machineName);
  return required === null || typed.trim() === required;
}

const GROUP_STATUS: Record<PromoteResult['groups'][number]['status'], DiffBadge> = {
  applied: { text: 'applied', tone: 'mb-badge-ok' },
  failed: { text: 'failed', tone: 'mb-badge-danger' },
  skipped: { text: 'skipped', tone: 'mb-badge' },
};

export interface PromoteOutcome {
  tone: 'ok' | 'warn' | 'danger';
  title: string;
  message: string;
  groups: { group: string; label: string; badge: DiffBadge; error: string | null }[];
}

/** A promote's result, as a sentence and a status per table group. */
export function promoteOutcome(
  result: PromoteResult,
  environmentName: string,
  describeError: (key: string) => string,
): PromoteOutcome {
  const snapshot = result.snapshot ? ' A snapshot of production was taken first.' : '';
  const outcome =
    result.status === 'applied'
      ? {
          tone: 'ok' as const,
          title: `Promoted ${environmentName}`,
          message: `Production now has the ${result.mode === 'full' ? 'config and content' : 'config'} of ${environmentName}.${snapshot}`,
        }
      : result.status === 'partial'
        ? {
            tone: 'warn' as const,
            title: 'Promoted in part',
            message: `Some parts were written to production before one failed; the rest were skipped.${snapshot}`,
          }
        : {
            tone: 'danger' as const,
            title: 'Promote failed',
            message: `Nothing was written to production.${snapshot}`,
          };
  return {
    ...outcome,
    groups: result.groups.map((group) => ({
      group: group.group,
      label: diffKindLabel(group.group),
      badge: GROUP_STATUS[group.status],
      error: group.error ? describeError(group.error) : null,
    })),
  };
}

/**
 * Where a switch lands: an editor's record differs per environment, so it goes to its
 * section; other pages stay.
 */
export function switchPath(route: { path: string; meta: Record<string, unknown> }): string {
  const { editor, section } = route.meta;
  return editor && typeof section === 'string' && section ? section : route.path;
}
