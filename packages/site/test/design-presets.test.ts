import { describe, expect, it } from 'vitest';
import {
  DESIGN_PRESETS,
  defaultDesignPreset,
  designPresetBundle,
  type PresetType,
  THEME_CATEGORIES,
  validateThemeBundle,
} from '../src/index.js';

const TYPES: PresetType[] = [
  {
    name: 'hero',
    kind: 'block',
    fields: [
      { name: 'headline', type: 'string' },
      { name: 'subline', type: 'string' },
      { name: 'image', type: 'asset' },
    ],
  },
  {
    name: 'testimonials',
    kind: 'block',
    fields: [
      { name: 'headline', type: 'string' },
      { name: 'items', type: 'content', settings: { multiple: true } },
    ],
  },
  // A block without a preset design keeps the generated one.
  { name: 'faq', kind: 'block', fields: [{ name: 'question', type: 'string' }] },
  {
    name: 'page',
    kind: 'content',
    fields: [
      { name: 'summary', type: 'string' },
      { name: 'components', type: 'blocks' },
    ],
  },
  {
    name: 'recipe',
    kind: 'content',
    fields: [
      { name: 'minutes', type: 'number' },
      { name: 'steps', type: 'richtext' },
    ],
  },
];

describe('design presets', () => {
  it('has presets for every theme category, the first of each is its default', () => {
    for (const category of THEME_CATEGORIES) {
      const presets = DESIGN_PRESETS.filter((entry) => entry.category === category.id);
      expect(presets.length).toBeGreaterThanOrEqual(4);
      expect(defaultDesignPreset(category.id)).toBe(presets[0]);
    }
  });

  it('uses every variant of the look and no two presets alike', () => {
    const used = (pick: (look: (typeof DESIGN_PRESETS)[number]['look']) => string) =>
      new Set(DESIGN_PRESETS.map((entry) => pick(entry.look)));
    expect(used((look) => look.hero)).toEqual(
      new Set([
        'split',
        'display',
        'editorial',
        'portrait',
        'panel',
        'statement',
        'fullbleed',
        'compact',
      ]),
    );
    expect(used((look) => look.header.kind)).toEqual(
      new Set(['bar', 'centered', 'split', 'floating']),
    );
    expect(used((look) => look.menu.style)).toEqual(
      new Set(['underline', 'pill', 'caps', 'plain', 'boxed']),
    );
    expect(used((look) => look.card)).toEqual(
      new Set(['elevated', 'bordered', 'tinted', 'outlined', 'plain', 'accent']),
    );
    expect(used((look) => look.list)).toEqual(new Set(['grid', 'rows', 'index']));
    expect(used((look) => look.quote)).toEqual(new Set(['cards', 'large', 'bar']));
    expect(used((look) => look.cta)).toEqual(new Set(['panel', 'band', 'outline']));
    expect(used((look) => look.text)).toEqual(new Set(['split', 'stacked', 'centered', 'ruled']));
    expect(used((look) => look.pageHeader)).toEqual(new Set(['band', 'plain', 'gradient']));
    expect(used((look) => JSON.stringify(look)).size).toBe(DESIGN_PRESETS.length);
    expect(new Set(DESIGN_PRESETS.map((entry) => entry.id)).size).toBe(DESIGN_PRESETS.length);
  });

  it.each(DESIGN_PRESETS.map((entry) => entry.id))('%s writes a valid bundle', (id) => {
    const bundle = designPresetBundle(id, { types: TYPES, locale: 'fr' });
    const result = validateThemeBundle(bundle);
    expect(result.ok ? [] : result.issues).toEqual([]);
    expect(bundle?.designs.map((design) => `${design.kind}:${design.key}`)).toEqual([
      'layout:default',
      'menu:main',
      'menu:footer',
      'block:hero',
      'block:testimonials',
      'page:page',
      'page:recipe',
    ]);
    // Static text is written in the space's locale too.
    expect(JSON.stringify(bundle)).toContain('"fr":"Menu"');
  });

  it('knows no preset of an unknown id', () => {
    expect(designPresetBundle('nope', { types: [], locale: 'en' })).toBeNull();
  });
});
