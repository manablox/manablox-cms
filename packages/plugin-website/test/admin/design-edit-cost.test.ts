/**
 * The cost of one edit in the page designer on a large design: the draft (dirty flag, undo
 * stack, autosave) and the canvas sync (preview input, stylesheet, the message to the frame).
 * A drag in the inspector sends one edit per frame, all in one undo group; this replays one.
 *
 * `DESIGN_EDIT_COST=1 pnpm --filter @manablox/plugin-website exec vitest run
 * --config vitest.admin.config.ts design-edit-cost` prints the medians;
 * `DESIGN_EDIT_COST_ROUNDS` repeats the drag, `DESIGN_EDIT_COST_SECTIONS` sizes the page.
 */
import { createTestSession, setupAdminTest, useTestSpace } from '@manablox/admin-sdk/testing';
import type { ContentTypeDefinition } from '@manablox/core';
import {
  type DesignNode,
  defaultTheme,
  generatePageDesign,
  type PageDesign,
  updateNode,
} from '@manablox/site';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

const detail = ref<{ data: unknown; status: string; design: { version: number } | null } | null>(
  null,
);
const saveDraft = vi.hoisted(() => vi.fn());
const sent = vi.hoisted(() => ({ designs: 0 }));

vi.mock('../../src/admin/queries', () => ({
  useSiteDesign: () => ({ data: detail, refetch: vi.fn(async () => undefined) }),
  useCanvasDesigns: () => ({ data: ref([]), isPending: ref(false) }),
  useCanvasMenus: () => ({ data: ref([]), isSuccess: ref(true), isError: ref(false) }),
  useSiteSettings: () => ({
    data: ref({ mode: 'designed', siteUrl: 'https://site.test' }),
    isPending: ref(false),
  }),
  useSiteDomains: () => ({ data: ref([]) }),
  design: { saveDraft },
}));
vi.mock('@manablox/live-preview', () => ({
  createEditorChannel: () => ({
    plugin: () => ({
      send: (name: string, payload: unknown) => {
        // postMessage copies the payload; the frame's copy is part of the sync.
        if (name === 'design') {
          structuredClone(payload);
          sent.designs += 1;
        }
      },
      on: () => undefined,
    }),
    destroy: () => undefined,
  }),
}));

const field = (id: string, name: string, type: string) => ({
  id,
  name,
  label: name,
  type,
  settings: {},
  required: false,
  localized: false,
  unique: false,
  admin: { zone: 'main', position: 0 },
});
const TYPES = [
  {
    id: 'article',
    name: 'article',
    label: 'Article',
    kind: 'content',
    isSystem: false,
    fields: [field('f1', 'intro', 'text'), field('f2', 'hero', 'asset')],
  },
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `block${index}`,
    name: `block${index}`,
    label: `Block ${index}`,
    kind: 'block',
    isSystem: false,
    fields: [field(`b${index}a`, 'title', 'string'), field(`b${index}b`, 'image', 'asset')],
  })),
] as unknown as ContentTypeDefinition[];

import { useDesignCanvas } from '../../src/admin/useDesignCanvas';
import { useDesignDraft } from '../../src/admin/useDesignDraft';
import { useDesignPreview } from '../../src/admin/useDesignPreview';

const SECTIONS = Number(process.env.DESIGN_EDIT_COST_SECTIONS ?? 40);
const EDITS = 60;
const FRAME_MS = 16;

/** A page of `SECTIONS` sections of 15 nodes each: 601 nodes by default. */
function largePage(): PageDesign {
  const text = (id: string, words: string): DesignNode => ({
    id,
    el: 'text',
    props: { text: { en: `${words} `.repeat(6).trim() } },
    style: { base: { marginBottom: 'space:2' } },
  });
  const sections: DesignNode[] = Array.from({ length: SECTIONS }, (_, s) => ({
    id: `s${s}`,
    el: 'section',
    style: { base: { paddingY: 'space:12' }, mobile: { paddingY: 'space:8' } },
    children: [
      {
        id: `s${s}-stack`,
        el: 'stack',
        style: { base: { gap: 'space:4' } },
        children: [
          { id: `s${s}-h`, el: 'heading', props: { level: 2, text: { en: `Section ${s}` } } },
          text(`s${s}-t`, 'Lorem ipsum dolor sit amet'),
          { id: `s${s}-img`, el: 'image', bind: { field: 'hero' } },
          {
            id: `s${s}-grid`,
            el: 'grid',
            style: { base: { gap: 'space:6' }, mobile: { gap: 'space:4' } },
            children: [0, 1, 2].map((c) => ({
              id: `s${s}-b${c}`,
              el: 'box',
              style: { base: { padding: 'space:4', radius: 'radius:md' } },
              children: [
                text(`s${s}-b${c}-t`, 'Consectetur adipiscing'),
                {
                  id: `s${s}-b${c}-btn`,
                  el: 'button',
                  props: { text: { en: 'Read more' }, variant: 'primary' },
                },
              ],
            })),
          },
        ],
      },
    ],
  }));
  const generated = generatePageDesign(TYPES[0] as never);
  return { ...generated, root: { id: 'root', el: 'stack', children: sections } };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Counts `JSON.stringify` calls and the characters they produce. */
function countStringify() {
  const original = JSON.stringify;
  const counts = { calls: 0, chars: 0 };
  JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
    const out = original(...args);
    counts.calls += 1;
    counts.chars += out?.length ?? 0;
    return out;
  }) as typeof JSON.stringify;
  return {
    counts,
    reset: () => Object.assign(counts, { calls: 0, chars: 0 }),
    restore: () => {
      JSON.stringify = original;
    },
  };
}

interface Run {
  /** Median ms per edit, measured to the flushed watchers. */
  editMs: number;
  stringifyPerEdit: number;
  charsPerEdit: number;
  /** After the drag: the dirty check, autosave and its save. */
  settleMs: number;
  settleStringify: number;
  undoSteps: number;
}

async function replayDrag(withCanvas: boolean): Promise<Run> {
  const scope = effectScope();
  const theme = defaultTheme();
  const iframe = ref({} as HTMLIFrameElement);
  const draft = scope.run(() => {
    const page = useDesignDraft('page', 'article');
    if (withCanvas) {
      const preview = useDesignPreview({
        locale: () => 'en',
        theme: () => theme,
        page: () =>
          page.draft.value ? { key: 'article', design: page.draft.value as PageDesign } : null,
        document: () => null,
        documentType: () => null,
        sample: () => false,
        focus: () => null,
      });
      useDesignCanvas({
        iframe,
        origin: () => 'https://site.test',
        payload: () => preview.payload.value,
        highlight: () => [],
        breakpoint: () => 'desktop',
        scheme: () => 'light',
        readOnly: () => false,
        on: {},
      });
    }
    return page;
  })!;
  await nextTick();
  // What the toolbar reads on every render.
  const render = () => [draft.isDirty.value, draft.canUndo.value, draft.canRedo.value];
  render();

  const stringify = countStringify();
  const times: number[] = [];
  const calls: number[] = [];
  const chars: number[] = [];
  const designsBefore = sent.designs;
  try {
    for (let edit = 0; edit < EDITS; edit += 1) {
      stringify.reset();
      const started = performance.now();
      const current = draft.draft.value as PageDesign;
      const root = updateNode(current.root, 's20-b1', (node) => ({
        ...node,
        style: { ...node.style, base: { ...node.style?.base, padding: `space:${edit % 12}` } },
      }));
      draft.update({ ...current, root }, 'style:s20-b1');
      await nextTick();
      render();
      times.push(performance.now() - started);
      calls.push(stringify.counts.calls);
      chars.push(stringify.counts.chars);
      vi.advanceTimersByTime(FRAME_MS);
    }
    if (withCanvas) expect(sent.designs - designsBefore).toBe(EDITS);

    stringify.reset();
    const started = performance.now();
    await vi.advanceTimersByTimeAsync(2_000);
    render();
    const settleMs = performance.now() - started;
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(draft.isDirty.value).toBe(false);
    const settleStringify = stringify.counts.calls;

    let undoSteps = 0;
    while (draft.canUndo.value) {
      draft.undo();
      undoSteps += 1;
    }
    return {
      editMs: median(times),
      stringifyPerEdit: median(calls),
      charsPerEdit: median(chars),
      settleMs,
      settleStringify,
      undoSteps,
    };
  } finally {
    stringify.restore();
    scope.stop();
  }
}

describe('page designer edit cost', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setupAdminTest({ api: { assets: { byIds: async () => [] } } });
    createTestSession({ role: 'superadmin' });
    useTestSpace({ name: 'Space' }, { contentTypes: TYPES as never });
    detail.value = { data: largePage(), status: 'unpublished', design: { version: 1 } };
    saveDraft.mockReset();
    saveDraft.mockResolvedValue({ version: 2 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replays a drag on a large page design', async () => {
    const rounds = Number(process.env.DESIGN_EDIT_COST_ROUNDS ?? 1);
    const results: Record<string, Run[]> = { draft: [], 'draft + canvas': [] };
    for (let round = 0; round < rounds; round += 1) {
      for (const withCanvas of [false, true]) {
        detail.value = { data: largePage(), status: 'unpublished', design: { version: 1 } };
        saveDraft.mockClear();
        results[withCanvas ? 'draft + canvas' : 'draft']!.push(await replayDrag(withCanvas));
      }
    }
    if (process.env.DESIGN_EDIT_COST) {
      const bytes = JSON.stringify(largePage()).length;
      const rows = Object.entries(results).map(([name, runs]) => ({
        path: name,
        'ms/edit (median)': median(runs.map((run) => run.editMs)).toFixed(3),
        'stringify/edit': median(runs.map((run) => run.stringifyPerEdit)),
        'chars/edit': median(runs.map((run) => run.charsPerEdit)),
        'settle ms': median(runs.map((run) => run.settleMs)).toFixed(3),
        'settle stringify': median(runs.map((run) => run.settleStringify)),
      }));
      process.stdout.write(`design: ${bytes} chars of JSON, ${EDITS} edits x ${rounds} rounds\n`);
      for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
    }
    for (const runs of Object.values(results)) {
      // One drag, one undo step, and nothing serialised while it lasts.
      expect(runs.every((run) => run.undoSteps === 1)).toBe(true);
      expect(runs.every((run) => run.stringifyPerEdit === 0)).toBe(true);
    }
  }, 120_000);
});
