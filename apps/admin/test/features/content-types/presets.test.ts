import { describe, expect, it } from 'vitest';
import { presetFields, presetsFor, TYPE_PRESETS } from '~/features/content-types/presets';

describe('type presets', () => {
  it('uses valid, unique field names', () => {
    for (const preset of TYPE_PRESETS) {
      const names = preset.fields.map((field) => field.name);
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/);
    }
  });

  it('offers presets per kind', () => {
    expect(presetsFor('block').map((preset) => preset.id)).toContain('hero');
    expect(presetsFor('content').map((preset) => preset.id)).toContain('article');
    expect(presetsFor('data').map((preset) => preset.id)).toContain('contact-submission');
  });

  it('leaves out presets whose name a type already has', () => {
    const ids = presetsFor('content', new Set(['page', 'hero'])).map((preset) => preset.id);
    expect(ids).not.toContain('page');
    expect(ids).toContain('article');
  });

  it('keeps form submissions off the delivery API', () => {
    const contact = TYPE_PRESETS.find((preset) => preset.id === 'contact-submission');
    expect(contact?.isPublishable).toBe(false);
  });

  it('builds fresh fields with positions and unshared settings', () => {
    const hero = TYPE_PRESETS.find((preset) => preset.id === 'hero')!;
    const first = presetFields(hero);
    const second = presetFields(hero);

    expect(first.map((field) => field.admin.position)).toEqual([0, 1, 2, 3, 4]);
    expect(first[0]).toMatchObject({ name: 'headline', required: true, localized: false });
    expect(first[0]!.id).not.toBe(second[0]!.id);
    expect(first[3]!.settings).toEqual({ accept: ['image/'] });
    expect(first[3]!.settings).not.toBe(first[4]!.settings);
  });

  it('offers a form block editors point at a databag', () => {
    const picked = TYPE_PRESETS.find((preset) => preset.id === 'form');
    expect(picked?.fields.find((field) => field.type === 'databag')?.required).toBe(true);
  });
});
