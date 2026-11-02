import { slugify } from '@manablox/core';
import { THEME_BUNDLE_FORMAT } from '@manablox/site';
import type { ThemeImportEntry, ThemeImportReport } from '../queries';

/** The download name of a theme bundle: the space name as a slug, `-draft` for drafts. */
export function bundleFilename(spaceName: string, variant: 'published' | 'draft'): string {
  const slug = slugify(spaceName).slice(0, 60) || 'site';
  return `${slug}-theme${variant === 'draft' ? '-draft' : ''}.json`;
}

/** A picked file's contents as a bundle to preview; the server checks the rest. */
export function readBundleText(
  text: string,
): { ok: true; bundle: unknown; name: string | null } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  const data = parsed as { format?: unknown; name?: unknown } | null;
  if (!data || typeof data !== 'object' || data.format !== THEME_BUNDLE_FORMAT) {
    return { ok: false, error: 'That file is not a Manablox theme.' };
  }
  return { ok: true, bundle: parsed, name: typeof data.name === 'string' ? data.name : null };
}

/** How the import names an entry to leave out. */
export const skipKey = (entry: Pick<ThemeImportEntry, 'kind' | 'sourceKey'>): string =>
  `${entry.kind}:${entry.sourceKey}`;

const KIND_LABELS: Record<ThemeImportEntry['kind'], string> = {
  theme: 'Theme',
  site: 'Site settings',
  layout: 'Layout',
  page: 'Page',
  block: 'Block',
  menu: 'Menu',
};

const ACTION_LABELS: Record<ThemeImportEntry['action'], string> = {
  create: 'New',
  replace: 'Replaces',
  skip: 'Skipped',
};

const REASONS: Record<NonNullable<ThemeImportEntry['reason']>, string> = {
  unknownType: 'This space has no type of that name.',
  exists: 'Already designed here; turn on "Replace" to overwrite it.',
  excluded: 'Left out.',
};

/** One row of the import table. */
export interface ThemeImportRow {
  key: string;
  kind: string;
  label: string;
  action: ThemeImportEntry['action'];
  actionLabel: string;
  tone: string;
  note: string | null;
  /** Whether the user may include or leave out the entry. */
  choosable: boolean;
  included: boolean;
}

/** Report entries as table rows; the theme and site settings first, as the bundle has them. */
export function importRows(report: ThemeImportReport): ThemeImportRow[] {
  return report.entries.map((entry) => {
    const notes: string[] = [];
    if (entry.reason) notes.push(REASONS[entry.reason]);
    if (entry.brokenBindings) {
      notes.push(
        `${entry.brokenBindings} ${entry.brokenBindings === 1 ? 'element shows a field' : 'elements show fields'} this type does not have.`,
      );
    }
    if (entry.key !== entry.sourceKey && entry.action !== 'skip' && entry.kind !== 'theme') {
      notes.push('Matched by name.');
    }
    return {
      key: skipKey(entry),
      kind: KIND_LABELS[entry.kind],
      label: entry.label,
      action: entry.action,
      actionLabel: ACTION_LABELS[entry.action],
      tone:
        entry.action === 'create'
          ? 'mb-badge-ok'
          : entry.action === 'replace'
            ? 'mb-badge-warn'
            : 'mb-badge',
      note: notes.length ? notes.join(' ') : null,
      choosable: entry.reason !== 'unknownType',
      included: entry.action !== 'skip',
    };
  });
}

/** One line on what an import did or would do. */
export function importSummary(report: ThemeImportReport, done = false): string {
  const count = (action: ThemeImportEntry['action']) =>
    report.entries.filter((entry) => entry.action === action).length;
  const [created, replaced, skipped] = [count('create'), count('replace'), count('skip')];
  if (created + replaced === 0)
    return done ? 'Nothing was imported.' : 'Nothing would be imported.';
  const parts = [
    created ? `${created} new` : '',
    replaced ? `${replaced} replaced` : '',
    skipped ? `${skipped} skipped` : '',
  ].filter(Boolean);
  return `${done ? 'Imported as drafts' : 'Lands as drafts'}: ${parts.join(', ')}.`;
}

/** `skip` with `key` added or removed. */
export function toggleSkip(skip: readonly string[], key: string, include: boolean): string[] {
  const rest = skip.filter((entry) => entry !== key);
  return include ? rest : [...rest, key];
}
