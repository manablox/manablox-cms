import { setupAdminTest, useTestSpace } from '@manablox/admin-sdk/testing';
import type { FieldDefinition } from '@manablox/core';
import {
  type BlockDesign,
  type BlockVariant,
  collectNodeIds,
  defaultTheme,
  generateBlockDesign,
  type ThemeDesign,
} from '@manablox/site';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';

const detail = ref<{ data: unknown; status: string; design: { version: number } | null } | null>(
  null,
);
const saveDraft = vi.hoisted(() => vi.fn());

vi.mock('../../src/admin/queries', () => ({
  useSiteDesign: () => ({ data: detail, refetch: vi.fn(async () => undefined) }),
  design: { saveDraft },
}));

import { applyAiVariant, proposedVariants } from '../../src/admin/model/ai-block-design';
import { contrastProblems, mergeAiTheme } from '../../src/admin/model/ai-theme';
import {
  bundleFilename,
  importRows,
  importSummary,
  readBundleText,
  skipKey,
  toggleSkip,
} from '../../src/admin/model/theme-bundle';
import { designIds } from '../../src/admin/model/variants';
import type { ThemeImportReport } from '../../src/admin/queries';
import { useDesignDraft } from '../../src/admin/useDesignDraft';

describe('theme bundle download', () => {
  it('names the file after the space, marking drafts', () => {
    expect(bundleFilename('My Bakery', 'published')).toBe('my-bakery-theme.json');
    expect(bundleFilename('My Bakery', 'draft')).toBe('my-bakery-theme-draft.json');
    expect(bundleFilename('   ', 'published')).toBe('site-theme.json');
    expect(bundleFilename('Ünïcode Café!', 'published')).toMatch(/^[a-z0-9-]+-theme\.json$/);
  });

  it('reads a picked file only when it is a theme bundle', () => {
    expect(readBundleText('{')).toEqual({ ok: false, error: 'That file is not valid JSON.' });
    expect(readBundleText('{"manabloxSpaceExport":1}')).toMatchObject({ ok: false });
    const read = readBundleText(JSON.stringify({ format: 'manablox-theme', name: 'Shop' }));
    expect(read).toMatchObject({ ok: true, name: 'Shop' });
  });
});

describe('theme import report', () => {
  const report: ThemeImportReport = {
    name: 'Shop',
    entries: [
      { kind: 'theme', key: 'default', sourceKey: 'default', label: 'Theme', action: 'replace' },
      {
        kind: 'block',
        key: 't-2',
        sourceKey: 't-1',
        label: 'Teaser',
        action: 'create',
        brokenBindings: 2,
      },
      {
        kind: 'menu',
        key: 'main',
        sourceKey: 'main',
        label: 'main',
        action: 'skip',
        reason: 'exists',
      },
      {
        kind: 'block',
        key: 'x',
        sourceKey: 'x',
        label: 'Gone',
        action: 'skip',
        reason: 'unknownType',
      },
      {
        kind: 'layout',
        key: 'default',
        sourceKey: 'default',
        label: 'default',
        action: 'skip',
        reason: 'excluded',
      },
    ],
    codeSkipped: false,
    missingAssets: [],
  };

  it('turns entries into rows with notes and choosability', () => {
    const rows = importRows(report);
    expect(rows.map((row) => [row.key, row.actionLabel, row.included, row.choosable])).toEqual([
      ['theme:default', 'Replaces', true, true],
      ['block:t-1', 'New', true, true],
      ['menu:main', 'Skipped', false, true],
      ['block:x', 'Skipped', false, false],
      ['layout:default', 'Skipped', false, true],
    ]);
    expect(rows[1]?.note).toContain('2 elements show fields');
    expect(rows[1]?.note).toContain('Matched by name.');
    expect(rows[3]?.note).toContain('no type of that name');
  });

  it('summarises and toggles skipped entries by their bundle key', () => {
    expect(importSummary(report)).toBe('Lands as drafts: 1 new, 1 replaced, 3 skipped.');
    expect(importSummary({ ...report, entries: [] }, true)).toBe('Nothing was imported.');
    const key = skipKey({ kind: 'block', sourceKey: 't-1' });
    const skip = toggleSkip([], key, false);
    expect(skip).toEqual(['block:t-1']);
    expect(toggleSkip(skip, key, true)).toEqual([]);
  });
});

function field(id: string, type: string): FieldDefinition {
  return {
    id,
    name: id,
    label: id,
    type,
    settings: {},
    required: false,
    localized: false,
    unique: false,
    admin: { zone: 'main', width: 100, position: 0 },
  };
}

describe('AI proposals', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupAdminTest({ api: {} });
    useTestSpace();
    detail.value = { data: defaultTheme(), status: 'generated', design: null };
    saveDraft.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies a proposed theme into the draft as one undoable step, keeping element styles', () => {
    const scope = effectScope();
    const draft = scope.run(() => useDesignDraft('theme', 'default', { autosave: false }))!;
    const start = draft.draft.value as ThemeDesign;
    const proposed: ThemeDesign = {
      ...defaultTheme(),
      colors: { ...start.colors, roles: { ...start.colors.roles, primary: '#123456' } },
      radius: { ...start.radius, md: '1rem' },
      elements: {},
      space: { 1: '9rem' },
    };

    draft.update(mergeAiTheme(start, proposed), 'ai');
    const applied = draft.draft.value as ThemeDesign;
    expect(applied.colors.roles.primary).toBe('#123456');
    expect(applied.radius.md).toBe('1rem');
    expect(applied.elements).toEqual(start.elements);
    expect(applied.space).toEqual(start.space);
    expect(draft.isDirty.value).toBe(true);

    draft.undo();
    expect((draft.draft.value as ThemeDesign).colors.roles.primary).toBe(
      start.colors.roles.primary,
    );
    scope.stop();
  });

  it('lists contrast pairs a proposal fails', () => {
    const theme = defaultTheme();
    const low = {
      ...theme,
      colors: { ...theme.colors, roles: { ...theme.colors.roles, text: '#fefefe', bg: '#ffffff' } },
    };
    expect(contrastProblems(theme)).toEqual([]);
    expect(contrastProblems(low).map((check) => check.label)).toContain('Text on background');
  });

  it('adds a proposed block variant or replaces the current one without id clashes', () => {
    const type = { id: 't', label: 'Teaser', fields: [field('title', 'string')] };
    const current = generateBlockDesign(type);
    // The model echoes the current ids.
    const proposal: BlockDesign = structuredClone(current);
    (proposal.variants.default as BlockVariant).label = 'Bold';
    expect(proposedVariants(proposal)).toEqual([{ name: 'default', label: 'Bold' }]);
    const variant = proposal.variants.default as BlockVariant;

    const added = applyAiVariant(current, variant, 'add', 'default');
    expect(added?.name).toBe('bold');
    const ids = [...collectNodeIds((added?.design.variants.bold as BlockVariant).root)];
    const before = designIds(current);
    expect(ids.some((id) => before.has(id))).toBe(false);

    const replaced = applyAiVariant(current, variant, 'replace', 'default');
    expect(replaced?.name).toBe('default');
    expect(Object.keys(replaced?.design.variants ?? {})).toEqual(['default']);
    // Its own ids may stay, since they only clashed with the tree being replaced.
    expect((replaced?.design.variants.default as BlockVariant).root.id).toBe(variant.root.id);
    expect((replaced?.design.variants.default as BlockVariant).label).toBe(
      (current.variants.default as BlockVariant).label,
    );
    expect(applyAiVariant(current, variant, 'replace', 'missing')).toBeNull();
  });
});
