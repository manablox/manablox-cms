import { describe, expect, it } from 'vitest';
import {
  canRestore,
  describeCounts,
  downloadName,
  RESTORE_MODES,
  scheduleText,
  snapshotRow,
} from '~/features/backups/model';

const snapshot = {
  id: '2026-09-25T10-15-00-000Z',
  spaceId: 's1',
  machineName: 'site',
  name: 'Site',
  createdAt: '2026-09-25T10:15:00.000Z',
  trigger: 'scheduled' as const,
  formatVersion: 1,
  size: 2 * 1024 * 1024,
  counts: { contentTypes: 1, contents: 12, assets: 3, menus: 1, workflows: 0 },
  manabloxSnapshot: 1 as const,
};

describe('backups model', () => {
  it('turns a snapshot into a row', () => {
    expect(snapshotRow(snapshot)).toMatchObject({
      id: snapshot.id,
      trigger: 'Scheduled',
      size: '2.0 MB',
      contents: '12 documents, 3 assets, 1 content type',
    });
    expect(snapshotRow({ ...snapshot, trigger: 'manual' }).trigger).toBe('By hand');
  });

  it('counts in the singular and the plural', () => {
    expect(describeCounts({ ...snapshot.counts, contents: 1, assets: 0 })).toBe(
      '1 document, 0 assets, 1 content type',
    );
  });

  it('describes the schedule and the window', () => {
    expect(scheduleText('daily', 7)).toBe(
      'A snapshot is taken every day; snapshots are kept for 7 days.',
    );
    expect(scheduleText('hourly', 1)).toBe(
      'A snapshot is taken every hour; snapshots are kept for 1 day.',
    );
    expect(scheduleText(null, null)).toBe(
      'No snapshots are taken automatically - create one when you need it; snapshots are kept until removed.',
    );
  });

  it('lets owners restore, superadmins counting as owners', () => {
    expect(canRestore('owner')).toBe(true);
    expect(canRestore('admin')).toBe(false);
    expect(canRestore(null)).toBe(false);
  });

  it('names the download and explains both modes', () => {
    expect(downloadName('site', snapshot.id)).toBe(`site-${snapshot.id}.manablox.json`);
    expect(RESTORE_MODES.replace.message).toContain('everything since is lost');
    expect(RESTORE_MODES.new.message).toContain('stays as it is');
  });
});
