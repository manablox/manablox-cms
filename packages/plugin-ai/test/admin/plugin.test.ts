import type { FieldContext, FieldDefinition } from '@manablox/admin-sdk';
import { queryClient } from '@manablox/admin-sdk';
import { createTestSession, setupAdminTest, useTestSpace } from '@manablox/admin-sdk/testing';
import type { RealtimeEvent } from '@manablox/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ai from '../../src/admin/index';
import { aiKeys } from '../../src/admin/keys';

const field = (type: string, settings: Record<string, unknown> = {}) =>
  ({ type, settings }) as unknown as FieldDefinition;
const context = (readOnly = false) => ({ readOnly }) as unknown as FieldContext;

describe('the AI admin plugin', () => {
  beforeEach(() => {
    setupAdminTest({ api: {} });
  });

  it('fills the core slots, gated by the plugin flag', () => {
    const slots = ai.slots ?? {};
    for (const slot of [
      'field.actions',
      'assets.actions',
      'content.editor.actions',
      'contentType.list.actions',
      'template.list.actions',
    ] as const) {
      expect(slots[slot]?.map((entry) => entry.feature)).toEqual([undefined]);
    }
    expect(slots['assets.actions']?.[0]?.permission).toBe('asset:write');
    expect(slots['contentType.list.actions']?.[0]?.permission).toBe('contentType:write');
    expect(slots['space.create.starters']?.[0]?.feature).toBe('plugins.ai.designSpace');
    expect(ai.settingsSections).toEqual([
      expect.objectContaining({ id: 'ai', scope: 'space', label: 'AI' }),
    ]);
    expect(ai.transferSections?.map((section) => section.kind)).toEqual(['ai.providers']);
  });

  it('puts wands beside editable text and asset fields only', () => {
    const when = ai.slots?.['field.actions']?.[0]?.when;
    const shown = (definition: FieldDefinition, readOnly = false) =>
      when?.({ field: definition, value: null, update: () => {}, context: context(readOnly) });
    expect(shown(field('string'))).toBe(true);
    expect(shown(field('richtext'))).toBe(true);
    expect(shown(field('asset'))).toBe(true);
    expect(shown(field('string'), true)).toBe(false);
    expect(shown(field('number'))).toBe(false);
    // A filter field stores nothing to add a generated asset to.
    expect(shown(field('asset', { multiple: true, selection: 'filter' }))).toBe(false);
  });

  it('offers the described space only to those who may use AI somewhere', () => {
    const starter = ai.slots?.['space.create.starters']?.[0];
    const props = { draft: {}, setDraft: () => {} };
    useTestSpace({ id: 's1', name: 'One' });
    createTestSession({ role: 'editor', permissions: { s1: [] } });
    expect(starter?.when?.(props)).toBe(false);
    createTestSession({ role: 'editor', permissions: { s1: ['ai:use'] } });
    expect(starter?.when?.(props)).toBe(true);
  });

  it('creates the ticked designed types and copies the providers when asked', () => {
    const starter = ai.slots?.['space.create.starters']?.[0];
    const types = [
      { name: 'event', kind: 'content', fields: [] },
      { name: 'unwanted', kind: 'content', fields: [] },
    ];
    expect(starter?.validate?.({})).toBe('Describe the space and let it be designed first.');
    const draft = {
      source: 's1',
      design: { types, notes: '', problems: [] },
      selected: ['event'],
      copyProviders: true,
      canCopy: true,
    };
    expect(starter?.validate?.(draft)).toBeNull();
    expect(starter?.plan?.(draft)).toEqual([types[0]]);
    expect(starter?.data?.(draft)).toEqual({ copyFrom: 's1' });
    expect(starter?.data?.({ ...draft, copyProviders: false })).toBeUndefined();
    expect(starter?.data?.({ ...draft, canCopy: false })).toBeUndefined();
    expect(starter?.created?.(draft)).toBe('with 1 types');
  });

  it('refetches its queries on live provider, settings and generation events', () => {
    for (const kind of ['ai.provider', 'ai.settings', 'ai.generation']) {
      queryClient.setQueryData(aiKeys.providers('s1'), []);
      ai.realtime?.[kind]?.({ spaceId: 's1' } as unknown as RealtimeEvent);
      expect(queryClient.getQueryState(aiKeys.providers('s1'))?.isInvalidated).toBe(true);
    }
  });

  it('labels its activity entries', () => {
    const entities = ai.audit?.entities ?? {};
    expect(entities['ai.provider']?.label).toBe('AI provider');
    expect(entities['ai.provider']?.route?.(null, null)).toBe('/settings?tab=ai.ai');
    expect(entities['ai.generation']?.label).toBe('AI generation');
    expect(ai.audit?.actions?.['ai.generation.create']).toBe('Generated content with AI');
    expect(ai.audit?.actions?.['ai.settings.update']).toBe('Changed the AI settings');
  });

  it('names its features and its usage metric', () => {
    expect(Object.keys(ai.features ?? {})).toEqual([
      'plugins.ai',
      'plugins.ai.images',
      'plugins.ai.video',
      'plugins.ai.designModels',
      'plugins.ai.designSpace',
      'plugins.ai.workflows',
    ]);
    expect(ai.usage?.['plugins.ai.calls']?.label).toBe('AI calls');
  });

  it('exposes its components, composables and feature keys to other bundles', () => {
    const expose = vi.fn();
    ai.setup?.({ expose } as never);
    const api = expose.mock.calls[0]?.[0];
    expect(Object.keys(api).sort()).toEqual(
      [
        'DesignDialog',
        'ProviderSelect',
        'Sparkles',
        'WandButton',
        'features',
        'fieldToText',
        'useDesignRun',
        'useWand',
      ].sort(),
    );
    expect(api.features.designModels).toBe('plugins.ai.designModels');
    expect(api.fieldToText('richtext', { content: [{ text: 'Hi' }, { text: 'there' }] })).toBe(
      'Hi there',
    );
  });
});
