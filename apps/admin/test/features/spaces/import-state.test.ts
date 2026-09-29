import type { Space } from '@manablox/admin-sdk/lib/api-types';
import { describe, expect, it } from 'vitest';
import { importStateOf, stepLabel } from '~/features/spaces/import-state';

const space = (over: Partial<Space>): Space =>
  ({
    id: 's1',
    name: 'Site',
    machineName: 'site',
    importStatus: null,
    importProgress: null,
    updatedAt: new Date(),
    ...over,
  }) as Space;

const progress = (over: Record<string, unknown> = {}) =>
  ({
    id: 'i1',
    done: 3,
    total: 12,
    step: 'contents:2',
    actorId: null,
    selection: {},
    resumable: true,
    notes: [],
    error: null,
    ...over,
  }) as Space['importProgress'];

describe('import state', () => {
  it('names steps and batches in words', () => {
    expect(stepLabel('contents:2')).toBe('Documents, batch 2');
    expect(stepLabel('finish')).toBe('Storing files');
    expect(stepLabel(null)).toBe('Starting');
  });

  it('is null for a ready space and reports progress for an importing one', () => {
    expect(importStateOf(space({}))).toBeNull();
    expect(
      importStateOf(space({ importStatus: 'importing', importProgress: progress() })),
    ).toMatchObject({ status: 'importing', percent: 25, step: 'Documents, batch 2', stale: false });
  });

  it('carries the error of a failed import, and flags an idle one as stale', () => {
    const failed = importStateOf(
      space({
        importStatus: 'failed',
        importProgress: progress({ error: { key: 'internal.error', message: 'disk full' } }),
      }),
    );
    expect(failed).toMatchObject({
      status: 'failed',
      error: 'Something went wrong on the server.',
      resumable: true,
    });
    const keyed = importStateOf(
      space({
        importStatus: 'failed',
        importProgress: progress({
          error: { key: 'space.import.running', params: {}, message: 'space.import.running' },
        }),
      }),
    );
    expect(keyed?.error).toBe('That import is still running.');
    const unknown = importStateOf(
      space({
        importStatus: 'failed',
        importProgress: progress({ error: { key: 'some.new.key', message: 'masked <path>' } }),
      }),
    );
    expect(unknown?.error).toBe('masked <path>');
    const idle = importStateOf(
      space({
        importStatus: 'importing',
        importProgress: progress(),
        updatedAt: new Date(Date.now() - 3_600_000),
      }),
    );
    expect(idle?.stale).toBe(true);
  });
});
