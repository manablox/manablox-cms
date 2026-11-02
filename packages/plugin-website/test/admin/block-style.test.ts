import type { BlockValue, ContentTypeDefinition } from '@manablox/core';
import type { BlockInstanceStyle } from '@manablox/site';
import { describe, expect, it } from 'vitest';
import {
  blockDesignOf,
  cleanInstanceDesign,
  instanceDesignOf,
  instanceStyleIssues,
  toggledHide,
  variantOptions,
  withInstanceDesign,
  withStyleValue,
  withVariant,
} from '../../src/admin/model/block-style';

const block: BlockValue = { blockId: 'b1', type: 'teaser', fields: { title: 'Hi' } };

const teaserType = {
  id: 'teaser',
  label: 'Teaser',
  fields: [
    { id: 'f1', name: 'title', type: 'string', settings: {}, required: false, label: 'Title' },
  ],
} as unknown as ContentTypeDefinition;

// The inspector clears a value by setting it to undefined.
const loose = (style: Record<string, unknown>) => style as BlockInstanceStyle;

describe('block style model', () => {
  it('drops empty values, an empty style and an empty variant', () => {
    expect(cleanInstanceDesign(undefined)).toBeUndefined();
    expect(cleanInstanceDesign({ variant: '', style: {} })).toBeUndefined();
    expect(
      cleanInstanceDesign({
        style: loose({
          background: 'color:primary/50',
          paddingY: undefined,
          hide: [],
          backgroundImage: { assetId: '' },
        }),
      }),
    ).toEqual({ style: { background: 'color:primary/50' } });
    expect(
      cleanInstanceDesign({
        variant: 'dark',
        style: {
          backgroundImage: { assetId: 'a1', position: 'top', repeat: false },
          paddingX: '0',
        },
      }),
    ).toEqual({
      variant: 'dark',
      style: { backgroundImage: { assetId: 'a1', position: 'top' }, paddingX: '0' },
    });
  });

  it('sets and clears the design on the block, keeping fields apart', () => {
    const styled = withInstanceDesign(block, { style: { textAlign: 'center' } });
    expect(styled).toEqual({ ...block, ext: { website: { style: { textAlign: 'center' } } } });
    expect(instanceDesignOf(styled)).toEqual({ style: { textAlign: 'center' } });
    expect(withInstanceDesign(styled, { style: loose({ textAlign: undefined }) })).toEqual(block);
    expect(withInstanceDesign(styled, undefined)).not.toHaveProperty('ext');
    // Other plugins' data stays.
    const shared = { ...styled, ext: { ...styled.ext, other: 1 } };
    expect(withInstanceDesign(shared, undefined)).toEqual({ ...block, ext: { other: 1 } });
  });

  it('changes one style value at a time', () => {
    let design = withStyleValue(undefined, 'background', 'color:accent');
    design = withStyleValue(design, 'width', 'full');
    expect(design).toEqual({ style: { background: 'color:accent', width: 'full' } });
    design = withStyleValue(design, 'background', undefined);
    expect(design).toEqual({ style: { width: 'full' } });
    expect(withStyleValue(design, 'width', undefined)).toBeUndefined();
  });

  it('stores a variant only when it is not the default', () => {
    expect(withVariant(undefined, 'dark', 'default')).toEqual({ variant: 'dark' });
    expect(withVariant({ variant: 'dark' }, 'default', 'default')).toBeUndefined();
    expect(withVariant({ variant: 'dark', style: { gap: 'space:4' } }, '', 'default')).toEqual({
      style: { gap: 'space:4' },
    });
  });

  it('toggles hidden breakpoints in a stable order', () => {
    expect(toggledHide(undefined, 'mobile')).toEqual(['mobile']);
    expect(toggledHide(['mobile'], 'desktop')).toEqual(['desktop', 'mobile']);
    expect(toggledHide(['mobile'], 'mobile')).toBeUndefined();
  });

  it('reports validation issues by style key', () => {
    expect(instanceStyleIssues({ background: 'color:primary' })).toEqual({});
    const issues = instanceStyleIssues({
      paddingY: 'nope' as never,
      width: 'huge' as never,
    });
    expect(Object.keys(issues).sort()).toEqual(['paddingY', 'width']);
  });

  it('lists variants of the stored design, else of the generated one', () => {
    const stored = {
      default: 'plain',
      variants: {
        dark: { label: 'Dark', root: { id: 'root', el: 'box' } },
        plain: { label: 'Plain', root: { id: 'root', el: 'box' } },
      },
    };
    expect(variantOptions(blockDesignOf(stored, teaserType) as never)).toEqual([
      { value: 'plain', label: 'Plain' },
      { value: 'dark', label: 'Dark' },
    ]);
    const generated = blockDesignOf(null, teaserType);
    expect(generated?.default).toBeTruthy();
    expect(variantOptions(generated)).toHaveLength(Object.keys(generated?.variants ?? {}).length);
    const shipped = {
      default: 'x',
      variants: { x: { label: 'X', root: { id: 'root', el: 'box' } } },
    };
    expect(blockDesignOf(null, { ...teaserType, plugins: { website: shipped } } as never)).toBe(
      shipped,
    );
    expect(blockDesignOf(null, null)).toBeNull();
  });
});
