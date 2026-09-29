import type { ContentTypeSummary, FieldTypeMeta } from '@manablox/admin-sdk/lib/api-types';
import type { BlockValue } from '@manablox/core';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useDraftBlocks } from '~/features/content/useDraftBlocks';
import type { DraftDocument } from '~/features/content/useDraftStore';

const teaser = {
  id: 'type-teaser',
  name: 'teaser',
  label: 'Teaser',
  kind: 'block',
  fields: [
    { id: 'f-headline', name: 'headline', label: 'Headline', type: 'string', settings: {} },
    { id: 'f-count', name: 'count', label: 'Count', type: 'number', settings: {} },
  ],
} as unknown as ContentTypeSummary;
const page = {
  id: 'type-page',
  name: 'page',
  label: 'Page',
  fields: [
    { id: 'f-components', name: 'components', label: 'Components', type: 'blocks', settings: {} },
  ],
} as unknown as ContentTypeSummary;

const block = (id: string, headline: string): BlockValue => ({
  blockId: id,
  type: teaser.id,
  fields: { headline },
});

function setup() {
  const doc = ref<DraftDocument | null>({
    spaceId: 's',
    typeId: page.id,
    locale: 'en',
    parentId: null,
    title: 'Home',
    slug: 'home',
    fields: { components: { blocks: [block('a', 'One'), block('b', 'Two'), block('c', 'Three')] } },
    position: 0,
    tags: [],
  });
  const selection = ref<(string | number)[] | null>(null);
  const blocks = useDraftBlocks({
    doc: () => doc.value,
    contentType: () => page,
    typeById: (id) => [teaser, page].find((type) => type.id === id) ?? null,
    fieldTypeMeta: (name) =>
      ({ nested: name === 'blocks', admin: { summary: name === 'string' } }) as FieldTypeMeta,
    blockKinds: () => [teaser],
    selection,
  });
  const headlines = () => blocks.listAt(['components']).map((entry) => entry.fields.headline);
  return { doc, selection, blocks, headlines };
}

describe('useDraftBlocks', () => {
  it('moves a block and keeps the selection on it, down to the selected field', () => {
    const { selection, blocks, headlines } = setup();
    selection.value = ['components', 0, 'headline'];
    blocks.move(['components'], 0, 2);
    expect(headlines()).toEqual(['Two', 'Three', 'One']);
    expect(selection.value).toEqual(['components', 2, 'headline']);
    expect(blocks.selectedIndex.value).toBe(2);
    expect(blocks.selectedFieldName.value).toBe('headline');
  });

  it('clears the selection when the selected block is removed', () => {
    const { selection, blocks, headlines } = setup();
    selection.value = ['components', 1];
    blocks.remove(['components'], 1);
    expect(headlines()).toEqual(['One', 'Three']);
    expect(selection.value).toBeNull();
    blocks.remove(['components'], 5);
    expect(headlines()).toEqual(['One', 'Three']);
  });

  it('inserts a block of the chosen type, clamped into the list', () => {
    const { blocks, headlines } = setup();
    const path = blocks.insert(['components'], 99, teaser.id);
    expect(path).toEqual(['components', 3]);
    expect(headlines()).toEqual(['One', 'Two', 'Three', undefined]);
    expect(blocks.allowedTypes(['components'])).toEqual([teaser]);
  });

  it('describes the selection: block, list, siblings, definition and label', () => {
    const { selection, blocks } = setup();
    expect(blocks.selectedBlock.value).toBeNull();
    selection.value = ['components', 1];
    expect(blocks.selectedBlock.value?.blockId).toBe('b');
    expect(blocks.selectedList.value).toEqual(['components']);
    expect(blocks.selectedSiblings.value).toHaveLength(3);
    expect(blocks.selectedListDefinition.value?.name).toBe('components');
    expect(blocks.selectedTypeLabel.value).toBe('Teaser');
    expect(blocks.definitionFor('headline')?.id).toBe('f-headline');
    expect(blocks.labelOf(blocks.selectedBlock.value as BlockValue)).toBe('Teaser - Two');
    selection.value = ['title'];
    expect(blocks.selectedTopField.value).toBe('title');
    expect(blocks.definitionFor('components')?.id).toBe('f-components');
  });

  it('writes inline edits per field type', async () => {
    const { doc, blocks } = setup();
    await blocks.edit(['title'], 'text', 'Renamed\n', '');
    expect(doc.value?.title).toBe('Renamed');
    await blocks.edit(['components', 0, 'headline'], 'text', 'First\n\n', '');
    await blocks.edit(['components', 1, 'count'], 'text', ' 1,5 ', '');
    await blocks.edit(['components', 2, 'count'], 'text', 'x', '');
    const list = blocks.listAt(['components']);
    expect(list[0]?.fields.headline).toBe('First');
    expect(list[1]?.fields.count).toBe(1.5);
    expect(list[2]?.fields.count).toBeNull();
  });
});
