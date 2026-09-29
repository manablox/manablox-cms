import { hasMessage, messageForKey } from '@manablox/admin-sdk/lib/messages';
import { pluginTransferSections } from '~/lib/plugins/registry';
import type { Space } from './queries';

/** How long an import may show no progress before it counts as interrupted (as the server). */
const STALE_IMPORT_MS = 10 * 60 * 1000;

export interface ImportState {
  status: 'importing' | 'failed';
  /** 0-100. */
  percent: number;
  /** What runs next, or what failed, in words. */
  step: string;
  error: string | null;
  /** A resume needs no new upload. */
  resumable: boolean;
  /** Importing, but idle for so long it can be resumed. */
  stale: boolean;
}

const SECTION_LABELS: Record<string, string> = {
  contentTypes: 'Content types',
  contents: 'Documents',
  assets: 'Assets',
  menus: 'Menus',
  roles: 'Roles',
  credentials: 'Credentials',
  tags: 'Tags',
  publish: 'Publishing',
  finish: 'Storing files',
};

/** `contents:3` as "Documents, batch 3". */
export function stepLabel(step: string | null): string {
  if (!step) return 'Starting';
  const [section = '', batch] = step.split(':');
  const label =
    SECTION_LABELS[section] ??
    pluginTransferSections().find((entry) => entry.kind === section)?.label ??
    section;
  return batch ? `${label}, batch ${batch}` : label;
}

/** The unfinished import of a space; `null` when it is ready. */
export function importStateOf(space: Space, now = Date.now()): ImportState | null {
  const status = space.importStatus;
  const progress = space.importProgress;
  if (!status) return null;
  const done = progress?.done ?? 0;
  const total = Math.max(progress?.total ?? 1, 1);
  return {
    status,
    percent: Math.min(100, Math.round((done / total) * 100)),
    step: stepLabel(progress?.step ?? null),
    error: progress?.error ? errorText(progress.error) : null,
    resumable: progress?.resumable ?? false,
    stale: status === 'importing' && now - new Date(space.updatedAt).getTime() > STALE_IMPORT_MS,
  };
}

/** The translated key; the server's masked message when the admin has no sentence for it. */
function errorText(error: NonNullable<NonNullable<Space['importProgress']>['error']>): string {
  return hasMessage(error.key) ? messageForKey(error.key, error.params) : error.message;
}
