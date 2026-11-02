import { type ContentTypeDefinition, defineContentType } from '@manablox/core';
import { type BlockDesign, defaultTheme, starterThemes } from '@manablox/site';
import { describe, expect, it } from 'vitest';
import { designSiteBlock, designSiteTheme } from '../../src/server/ai/design.js';
import {
  composeSiteBlockDesignPrompt,
  readSiteBlockDesign,
} from '../../src/server/ai/site-block.js';
import {
  composeSiteThemeDesignPrompt,
  contrast,
  readSiteThemeDesign,
} from '../../src/server/ai/site-theme.js';
import { fakeDesigner } from '../helpers/fake-ai.js';

const teaser = defineContentType({
  name: 'teaser',
  kind: 'block',
  fields: [
    { name: 'headline', type: 'string' },
    { name: 'body', type: 'richtext' },
    {
      name: 'points',
      type: 'repeater',
      settings: { fields: [{ id: 'point', name: 'point', type: 'string' }] },
    },
  ],
}) as ContentTypeDefinition;
const headline = teaser.fields[0]?.id as string;
const points = teaser.fields[2]?.id as string;

const goodTheme = {
  name: 'Harbour',
  palette: { navy: '#0b1f3a', sand: '#f5efe6', white: '#ffffff', gold: '#b7791f', gray: '#5b6472' },
  roles: {
    bg: 'white',
    surface: 'sand',
    text: 'navy',
    muted: 'gray',
    primary: 'navy',
    onPrimary: 'white',
    border: '#d9d4cc',
    accent: 'gold',
  },
  fonts: { heading: 'source-serif-4', body: 'inter' },
  scale: 1.333,
  headingWeight: 600,
  radius: 'small',
  shadow: 'soft',
  notes: 'Navy on sand.',
};

const goodBlock = {
  variants: {
    default: {
      label: 'Default',
      root: {
        el: 'stack',
        style: { base: { gap: 'space:4', padding: 'space:6', background: 'color:surface' } },
        children: [
          { el: 'heading', bind: { field: headline }, props: { level: 2 } },
          {
            el: 'repeat',
            bind: { field: points },
            children: [{ el: 'text', bind: { field: `${points}.point` } }],
          },
        ],
      },
    },
  },
  default: 'default',
  notes: 'A card.',
};

describe('site theme design', () => {
  const context = { base: defaultTheme(), brandColor: '#0b1f3a' };

  it('names the brand color, the roles and the bundled fonts in the prompt', () => {
    const prompt = composeSiteThemeDesignPrompt('A calm harbour cafe', context);
    expect(prompt).toContain('#0b1f3a');
    expect(prompt).toContain('"onPrimary"');
    expect(prompt).toContain('"source-serif-4"');
    expect(prompt).toContain('The request: A calm harbour cafe');
  });

  it('builds a valid theme on the base from a good answer', async () => {
    const { value, problems } = await readSiteThemeDesign(goodTheme, context);
    expect(problems).toEqual([]);
    expect(value.name).toBe('Harbour');
    expect(value.theme?.colors.roles.primary).toBe('navy');
    expect(value.theme?.colors.palette.navy).toBe('#0b1f3a');
    expect(value.theme?.fonts.roles).toMatchObject({ heading: 'source-serif-4', body: 'inter' });
    expect(value.theme?.fonts.families.map((family) => family.id).sort()).toEqual(
      ['inter', 'jetbrains-mono', 'source-serif-4'].sort(),
    );
    expect(value.theme?.radius.md).toBe('0.25rem');
    // Element styles of the base stay.
    expect(value.theme?.elements).toEqual(context.base.elements);
  });

  it('reports low contrast, unknown fonts and bad colors', async () => {
    const { value, problems } = await readSiteThemeDesign(
      {
        ...goodTheme,
        palette: { ...goodTheme.palette, pale: '#eeeeee', bad: 'blue' },
        roles: { ...goodTheme.roles, text: 'pale' },
        fonts: { heading: 'comic-sans' },
      },
      context,
    );
    expect(value.theme).not.toBeNull();
    expect(problems.some((problem) => problem.includes('"text" on "bg"'))).toBe(true);
    expect(problems.some((problem) => problem.includes('"bad"'))).toBe(true);
    expect(problems.some((problem) => problem.includes('fonts.heading'))).toBe(true);
  });

  it('keeps palette entries the base element styles name', async () => {
    const bold = starterThemes().find((theme) => theme.id === 'bold')?.theme;
    const { value } = await readSiteThemeDesign(goodTheme, { base: bold ?? defaultTheme() });
    expect(value.theme?.colors.palette.violet).toBe(bold?.colors.palette.violet);
  });

  it('computes WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});

describe('site block design', () => {
  const context = { type: teaser, theme: defaultTheme(), locales: ['de', 'en'] };

  it('describes the fields by id and the theme tokens', () => {
    const prompt = composeSiteBlockDesignPrompt('A card', context);
    expect(prompt).toContain(`"${headline}": headline`);
    expect(prompt).toContain(`"${points}.point": point`);
    expect(prompt).toContain('space:<step>');
    expect(prompt).toContain('locale "de"');
    // Layout-only elements are not offered.
    expect(prompt).not.toContain('breadcrumbs');
  });

  it('fills node ids and accepts a valid tree', async () => {
    const { value, problems } = await readSiteBlockDesign(structuredClone(goodBlock), context);
    expect(problems).toEqual([]);
    const root = value.design?.variants.default?.root;
    expect(root?.id).toMatch(/^[a-z]/);
    expect(root?.children?.map((child) => child.id)).toHaveLength(2);
    expect(value.unplaced).toEqual(['body']);
  });

  it('reports invalid styles and bindings to missing fields', async () => {
    const answer = structuredClone(goodBlock) as {
      variants: { default: { root: Record<string, unknown> } };
    };
    const root = answer.variants.default.root;
    root.style = { base: { gap: '17px' } };
    (root.children as Array<Record<string, unknown>>).push({
      el: 'text',
      bind: { field: 'nope' },
    });
    const invalid = await readSiteBlockDesign(answer, context);
    expect(invalid.value.design).toBeNull();
    expect(invalid.problems.some((problem) => problem.includes('style.base.gap'))).toBe(true);

    root.style = undefined;
    const broken = await readSiteBlockDesign(answer, context);
    expect(broken.value.design).not.toBeNull();
    expect(broken.problems.some((problem) => problem.includes('binds "nope"'))).toBe(true);
  });
});

/** The website's designs over a fake AI designer answering `answers` in turn. */
function setup(answers: unknown[]) {
  const designer = fakeDesigner(answers);
  const design = {
    designSiteTheme: (input: Parameters<typeof designSiteTheme>[1]) =>
      designSiteTheme(designer, input),
    designSiteBlock: (input: Parameters<typeof designSiteBlock>[1]) =>
      designSiteBlock(designer, input),
  };
  return { design, calls: designer.calls };
}

describe('AI site designs', () => {
  it('reports a rejected theme with its problems and returns the fixed one', async () => {
    const { design, calls } = setup([
      'not json',
      { ...goodTheme, roles: { ...goodTheme.roles, onPrimary: 'navy' } },
      goodTheme,
    ]);
    const result = await design.designSiteTheme({ spaceId: 's1', prompt: 'Harbour cafe' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.purpose).toBe('Site theme');
    expect(calls[0]?.prompt).toContain('The request: Harbour cafe');
    // The second answer's problems are what the AI plugin sends back with its retry.
    expect(calls[0]?.problems).toHaveLength(3);
    expect(calls[0]?.problems[1]?.join('\n')).toContain('"onPrimary" on "primary"');
    expect(result.problems).toEqual([]);
    expect(result.theme.colors.roles.onPrimary).toBe('white');
    expect(result.generationId).toBe('g1');
  });

  it('fails when no answer makes a usable block design', async () => {
    const { design } = setup([{ variants: 'x' }, { variants: 'x' }, { variants: 'x' }]);
    await expect(
      design.designSiteBlock({
        spaceId: 's1',
        prompt: 'A card',
        type: teaser,
        theme: defaultTheme(),
        locales: ['en'],
      }),
    ).rejects.toMatchObject({ key: 'plugins.ai.design.empty' });
  });

  it('returns a block design with the problems left after the retries', async () => {
    const withBrokenBinding = structuredClone(goodBlock);
    (withBrokenBinding.variants.default.root.children as unknown[]).push({
      el: 'text',
      bind: { field: 'gone' },
    });
    const { design } = setup([withBrokenBinding, withBrokenBinding, withBrokenBinding]);
    const result = await design.designSiteBlock({
      spaceId: 's1',
      prompt: 'A card',
      type: teaser,
      theme: defaultTheme(),
      locales: ['en'],
      current: null as BlockDesign | null,
    });
    expect(result.design.variants.default).toBeDefined();
    expect(result.problems).toEqual([expect.stringContaining('binds "gone"')]);
  });
});
