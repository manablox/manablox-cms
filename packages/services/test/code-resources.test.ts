import {
  defineCredential,
  definePlugin,
  type PluginResourceEntry,
  ref,
  resolveCodeRefs,
} from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CodeResourceService,
  codeCredentialId,
  defineResourceKind,
  reconcileResources,
  type SyncChange,
} from '../src/code-resources/index.js';
import { CredentialService } from '../src/credentials/service.js';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

/** A plugin kind whose rows live in memory; `target` points at a credential or another note. */
interface NoteEntry extends PluginResourceEntry {
  target: string;
}
interface NoteRow {
  id: string;
  slug: string;
  target: string;
  code: boolean;
}

const store = new Map<string, NoteRow[]>();
const pruned: string[] = [];

const notes = defineResourceKind<NoteEntry, NoteRow[]>({
  load: async () => (space, environment) => {
    const key = `${space.id}:${environment.id}`;
    if (!store.has(key)) store.set(key, []);
    return store.get(key) as NoteRow[];
  },
  plan: ({ declared, rows, key }) => {
    const ids = new Map(rows.map((row) => [row.slug, row.id]));
    for (const entry of declared)
      ids.set(entry.slug, ids.get(entry.slug) ?? `${key}:${entry.slug}`);
    return { resolve: (name) => ids.get(name) };
  },
  reconcile: ({ space, key, declared, rows, options, plan }) =>
    reconcileResources<NoteEntry, NoteRow, Omit<NoteRow, 'id'>>(space, declared, options, {
      kind: 'probe.note',
      slug: (entry) => entry.slug,
      id: (entry) => `${key}:${entry.slug}`,
      key: (entry) => entry.slug,
      rowKey: (row) => row.slug,
      taken: 'taken',
      rows,
      audit: {
        create: 'probe.note.create' as never,
        update: 'probe.note.update' as never,
        auditor: { record: async () => {}, in: () => ({ record: async () => {} }) } as never,
      },
      create: async (id, fields) => ({ id, ...fields }),
      update: async (id, fields) => ({ id, ...fields }),
      prepare: (entry) => {
        const desired = {
          slug: entry.slug,
          target: resolveCodeRefs(entry.target, plan.resolve),
          code: true,
        };
        return { desired, same: (row) => row.target === desired.target };
      },
    }),
  prune: async ({ declared, rows, options }) => {
    const wanted = new Set(declared.map((entry) => entry.slug));
    const gone = rows.filter((row) => row.code && !wanted.has(row.slug));
    pruned.push(...gone.map((row) => `${row.slug}:${options.prune ? 'delete' : 'disable'}`));
    return [];
  },
});

const probe = definePlugin({
  name: 'probe',
  resourceKinds: { 'probe.note': notes },
  resources: {
    'probe.note': [
      // Declared before what it points at: every kind plans before anything is written.
      { slug: 'first', spaces: '*', target: ref.of('probe.note', 'second') } as NoteEntry,
      { slug: 'second', spaces: '*', target: ref.credential('vault') } as NoteEntry,
    ],
  },
});

let ctx: ServiceContext;
let service: CodeResourceService;

beforeAll(async () => {
  ctx = await createServiceContext('code-resources', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
    config: {
      plugins: [probe],
      resources: { credentials: [defineCredential({ slug: 'vault', kind: 'bearer' })] },
    },
  });
  service = new CodeResourceService(ctx.manablox, ctx.repos, {
    content: ctx.content,
    credentials: new CredentialService(ctx.manablox, ctx.repos),
  });
});

afterAll(async () => {
  await ctx?.close();
});

beforeEach(() => {
  store.clear();
  pruned.length = 0;
});

const notesOf = (changes: SyncChange[]) => changes.filter((change) => change.kind === 'probe.note');

describe('plugin resource kinds', () => {
  it('reconcile through the kind, with references to core and to their own kind resolved', async () => {
    const dry = await service.sync({ spaceIds: [ctx.spaceId], dryRun: true });
    expect(notesOf(dry.changes).map((change) => [change.slug, change.action])).toEqual([
      ['first', 'created'],
      ['second', 'created'],
    ]);
    expect([...store.values()].flat()).toEqual([]);

    await service.sync({ spaceIds: [ctx.spaceId] });
    const rows = [...store.values()].flat();
    const second = rows.find((row) => row.slug === 'second');
    expect(second?.target).toBe(codeCredentialId(ctx.spaceId, 'vault'));
    expect(rows.find((row) => row.slug === 'first')?.target).toBe(second?.id);

    const again = await service.sync({ spaceIds: [ctx.spaceId] });
    expect(notesOf(again.changes).every((change) => change.action === 'unchanged')).toBe(true);
    // The credential slot is core's.
    expect(again.changes).toContainEqual(
      expect.objectContaining({ kind: 'credential', slug: 'vault' }),
    );
  });

  it('prune with the instance default resolved', async () => {
    await service.sync({ spaceIds: [ctx.spaceId] });
    for (const rows of store.values()) rows.push({ id: 'x', slug: 'gone', target: '', code: true });
    await service.sync({ spaceIds: [ctx.spaceId] });
    expect(pruned).toContain('gone:disable');
    pruned.length = 0;
    await service.sync({ spaceIds: [ctx.spaceId], prune: true });
    expect(pruned).toContain('gone:delete');
  });
});
