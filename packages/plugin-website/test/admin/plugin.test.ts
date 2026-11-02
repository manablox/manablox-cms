import { queryClient } from '@manablox/admin-sdk';
import { setupAdminTest } from '@manablox/admin-sdk/testing';
import type { RealtimeEvent } from '@manablox/core';
import { beforeEach, describe, expect, it } from 'vitest';
import website from '../../src/admin/index';
import { designKeys } from '../../src/admin/keys';

describe('the website admin plugin', () => {
  beforeEach(() => setupAdminTest({ api: {} }));

  it('adds the design pages under their old paths, gated by the plugin flag', () => {
    expect(website.name).toBe('website');
    expect(website.feature).toBeUndefined();
    const routes = website.routes ?? [];
    expect(routes.map((route) => route.name)).toHaveLength(11);
    expect(routes.every((route) => route.path.startsWith('design') && !route.feature)).toBe(true);
    expect(routes.find((route) => route.name === 'design')).toMatchObject({
      section: '/design',
      panel: 'design',
    });
    expect(routes.find((route) => route.name === 'design-block')?.editor).toBe('edit');
    expect(website.menu).toEqual([
      expect.objectContaining({ to: '/design', permission: 'website:read' }),
    ]);
    expect(website.sidePanels?.[0]).toMatchObject({ key: 'design', label: 'Design' });
  });

  it('fills the core slots', () => {
    const slots = website.slots ?? {};
    for (const slot of ['space.settings.sections', 'space.domains'] as const) {
      expect(slots[slot]?.map((item) => item.feature)).toEqual([undefined]);
    }
    expect(slots['space.domains']?.[0]?.permission).toBe('website:read');
    for (const slot of [
      'content.preview.target',
      'content.editor.actions',
      'block.inspector',
      'contentType.actions',
      'contentType.presets',
      'space.create.steps',
      'environment.address',
    ] as const) {
      expect(slots[slot]?.map((item) => item.feature)).toEqual([null]);
    }
    expect(website.transferSections?.map((section) => section.kind)).toEqual([
      'website.designs',
      'website.domains',
    ]);
  });

  it('refetches designs on live design and domain events', () => {
    queryClient.setQueryData(designKeys.list('s1'), []);
    website.realtime?.['website.domain']?.({ spaceId: 's1' } as unknown as RealtimeEvent);
    expect(queryClient.getQueryState(designKeys.list('s1'))?.isInvalidated).toBe(true);
  });

  it('labels and links its activity entries', () => {
    const entities = website.audit?.entities ?? {};
    expect(entities['website.design']?.route?.(null, { kind: 'theme' })).toBe('/design/theme');
    expect(entities['website.design']?.route?.(null, null)).toBe('/design');
    expect(entities['website.domain']?.label).toBe('Site domain');
    expect(website.audit?.verbs?.['website.settings.update']).toBe('Site mode');
    expect(
      website.audit?.outcomes?.['website.design.import']?.({ created: 2, replaced: 1 }, []),
    ).toBe('2 new, 1 replaced');
  });

  it('names its promote diff kind', () => {
    expect(website.diffKinds?.designs).toBe('Site design');
  });

  it('sends the theme and design for a designed site, by default while the instance allows one', () => {
    const step = website.slots?.['space.create.steps']?.[0];
    expect(step?.data?.({})).toEqual({
      theme: expect.stringMatching(/^builtin:/),
      preset: expect.any(String),
    });
    expect(step?.data?.({ theme: 'builtin:bold', preset: '', presetPicked: true })).toEqual({
      theme: 'builtin:bold',
      preset: '',
    });
    expect(step?.data?.({ frontend: 'external' })).toBeUndefined();
    expect(step?.stage?.welcome).toContain('designed site');
  });
});
