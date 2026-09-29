import { describe, expect, it } from 'vitest';
import { normaliseFields, normaliseValue } from '../src/normalise.js';

/** REST and GraphQL blocks must normalise to the same shape. */
describe('block normalisation', () => {
  const restBlock = {
    blockId: 'b1',
    type: 'teaser',
    fields: { headline: 'Hi', image: 'a1' },
  };

  const graphqlBlock = {
    blockId: 'b1',
    typeName: 'teaser',
    __typename: 'Teaser',
    headline: 'Hi',
    image: 'a1',
  };

  it('gives both shapes the same result', () => {
    expect(normaliseValue(restBlock)).toEqual(normaliseValue(graphqlBlock));
  });

  it('exposes the type, the field map and the flattened values', () => {
    for (const raw of [restBlock, graphqlBlock]) {
      const block = normaliseValue(raw) as Record<string, unknown>;
      expect(block.type).toBe('teaser');
      expect(block.blockId).toBe('b1');
      expect(block.headline).toBe('Hi');
      expect(block.fields).toEqual({ headline: 'Hi', image: 'a1' });
    }
  });

  it('drops __typename rather than using it as the type', () => {
    const block = normaliseValue(graphqlBlock) as Record<string, unknown>;
    expect(block).not.toHaveProperty('__typename');
    expect(block.fields).not.toHaveProperty('__typename');
  });

  it('keeps plugin data on the block, out of its fields, over both transports', () => {
    const design = { variant: 'dark', style: { background: 'color:primary' } };
    const options = { blockExtensions: ['design'] };
    for (const raw of [
      { ...restBlock, design },
      { ...graphqlBlock, design },
    ]) {
      const block = normaliseValue(raw, options) as Record<string, unknown>;
      expect(block.design).toEqual(design);
      expect(block.fields).not.toHaveProperty('design');
    }
    expect(normaliseValue({ ...restBlock, design }, options)).toEqual(
      normaliseValue({ ...graphqlBlock, design }, options),
    );
    // GraphQL answers `null` where REST leaves the key out.
    expect(normaliseValue({ ...graphqlBlock, design: null }, options)).toEqual(
      normaliseValue(restBlock, options),
    );
    // Unnamed, a GraphQL key is a field.
    expect(
      (normaliseValue({ ...graphqlBlock, design }) as { fields: Record<string, unknown> }).fields,
    ).toHaveProperty('design');
  });

  it('takes the GraphQL extension keys from the options', () => {
    const tone = { name: 'warm' };
    const block = normaliseValue(
      { ...graphqlBlock, tone, design: 'a field' },
      { blockExtensions: ['tone'] },
    ) as Record<string, unknown>;
    expect(block.tone).toEqual(tone);
    expect(block.fields).toEqual({ headline: 'Hi', image: 'a1', design: 'a field' });
    // Nested blocks follow the same keys.
    const nested = normaliseValue(
      { ...graphqlBlock, inner: { grid: null, blocks: [{ ...graphqlBlock, tone }] } },
      { blockExtensions: ['tone'] },
    ) as { inner: { blocks: Record<string, unknown>[] } };
    expect(nested.inner.blocks[0]?.fields).not.toHaveProperty('tone');
  });

  it('walks lists of blocks and blocks nested inside blocks', () => {
    const fields = normaliseFields({
      components: {
        grid: null,
        blocks: [
          {
            blockId: 'outer',
            type: 'section',
            fields: { children: { grid: null, blocks: [restBlock] } },
          },
        ],
      },
    });

    const outer = (fields.components as { blocks: Record<string, unknown>[] }).blocks[0] as Record<
      string,
      unknown
    >;
    const inner = (outer.children as { blocks: Record<string, unknown>[] }).blocks[0] as Record<
      string,
      unknown
    >;

    expect(outer.type).toBe('section');
    expect(inner.type).toBe('teaser');
    expect(inner.headline).toBe('Hi');
  });

  it('leaves ordinary values alone', () => {
    expect(normaliseValue('text')).toBe('text');
    expect(normaliseValue(null)).toBeNull();
    expect(normaliseValue({ id: 'a1', url: 'https://cdn/a1' })).toEqual({
      id: 'a1',
      url: 'https://cdn/a1',
    });
    expect(normaliseValue([1, 2])).toEqual([1, 2]);
  });
});

describe('item normalisation', () => {
  it('gives REST and GraphQL items the same shape, blocks inside normalised', () => {
    const rest = {
      itemId: 'i1',
      fields: {
        question: 'Why?',
        promo: { blockId: 'b1', type: 'teaser', fields: { headline: 'Hi' } },
      },
    };
    const graphql = {
      itemId: 'i1',
      __typename: 'FaqEntriesItem',
      question: 'Why?',
      promo: { blockId: 'b1', typeName: 'teaser', headline: 'Hi' },
    };
    const item = normaliseValue(rest) as Record<string, unknown>;
    expect(normaliseValue(graphql)).toEqual(item);
    expect(item.question).toBe('Why?');
    expect(item.fields).toMatchObject({ promo: { type: 'teaser', headline: 'Hi' } });
  });
});
