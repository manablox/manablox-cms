import { formatBytes, formatDateTime, plural } from '@manablox/admin-sdk/lib/format';
import type { SnapshotList } from './queries';

export type Snapshot = SnapshotList['items'][number];

/** One snapshot as the Backups table shows it. */
export interface SnapshotRow {
  id: string;
  date: string;
  trigger: string;
  size: string;
  contents: string;
}

const TRIGGERS: Record<Snapshot['trigger'], string> = {
  manual: 'By hand',
  scheduled: 'Scheduled',
  promote: 'Before a promote',
};

/** `12 documents, 3 assets`. */
export function describeCounts(counts: Snapshot['counts']): string {
  return [
    plural(counts.contents, 'document'),
    plural(counts.assets, 'asset'),
    plural(counts.contentTypes, 'content type'),
  ].join(', ');
}

export function snapshotRow(snapshot: Snapshot): SnapshotRow {
  return {
    id: snapshot.id,
    date: formatDateTime(snapshot.createdAt),
    trigger: TRIGGERS[snapshot.trigger],
    size: formatBytes(snapshot.size),
    contents: describeCounts(snapshot.counts),
  };
}

/** How snapshots are taken and how long they are kept, as one sentence. */
export function scheduleText(
  interval: SnapshotList['interval'],
  retentionDays: SnapshotList['retentionDays'],
): string {
  const taken =
    interval === 'hourly'
      ? 'A snapshot is taken every hour'
      : interval === 'daily'
        ? 'A snapshot is taken every day'
        : 'No snapshots are taken automatically - create one when you need it';
  const kept =
    retentionDays === null
      ? 'snapshots are kept until removed'
      : `snapshots are kept for ${plural(retentionDays, 'day')}`;
  return `${taken}; ${kept}.`;
}

/** What each restore mode does, for the confirmation. */
export const RESTORE_MODES = {
  new: {
    label: 'Restore as a new space',
    confirmLabel: 'Restore as new space',
    message: 'The snapshot becomes a separate space next to this one. This space stays as it is.',
  },
  replace: {
    label: 'Replace this space',
    confirmLabel: 'Replace this space',
    message:
      'This space is replaced by the snapshot: its content, content types and settings go back to that moment, and everything since is lost. Domains, members and the address stay.',
  },
} as const;

export type RestoreMode = keyof typeof RESTORE_MODES;

/** Only owners restore; superadmins count as owners. */
export const canRestore = (role: string | null): boolean => role === 'owner';

/** The file a downloaded snapshot is saved as. */
export const downloadName = (machineName: string, id: string): string =>
  `${machineName}-${id}.manablox.json`;
