import type { FieldDefinition } from '@manablox/core';
import {
  type BlockDesign,
  type DesignNode,
  defaultTheme,
  findNode,
  generateBlockDesign,
  nodeRef,
  PALETTE_TYPE,
  paletteKindType,
  validateSiteDesign,
} from '@manablox/site';
import { describe, expect, it } from 'vitest';
import {
  bindingLabel,
  bindingOptions,
  fieldAtPath,
  repeatScope,
  withRelated,
} from '../../src/admin/model/bindings';
import { blockCanvasInput } from '../../src/admin/model/block-canvas';
import { nodeIdOf, paletteDragKind } from '../../src/admin/model/elements';
import {
  canDropInto,
  createNode,
  dropSpot,
  indentNode,
  insertSpot,
  LABEL_PROP,
  nodeAtPath,
  nodeForField,
  nodeLabel,
  outdentNode,
  outlineRows,
  placeNode,
  renameNode,
  shiftNode,
} from '../../src/admin/model/outline';
import { resizeStyle, sizeToPx } from '../../src/admin/model/resize';
import {
  assetIdsIn,
  findBlockInstances,
  SAMPLE_IMAGE_ID,
  sampleAssets,
  sampleFields,
} from '../../src/admin/model/sample-data';
import {
  designIds,
  duplicateVariant,
  newVariant,
  removeVariant,
  variantName,
} from '../../src/admin/model/variants';

function field(id: string, type: string, settings: Record<string, unknown> = {}): FieldDefinition {
  return {
    id,
    name: id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    type,
    settings,
    required: false,
    localized: false,
    unique: false,
    admin: { zone: 'main', width: 100, position: 0 },
  };
}

const FIELDS: FieldDefinition[] = [
  field('title', 'string'),
  field('photo', 'asset', { accept: ['image/*'] }),
  field('gallery', 'asset', { multiple: true }),
  field('body', 'richtext'),
  field('cta', 'link'),
  field('when', 'date', { mode: 'date' }),
  field('team', 'repeater', {
    fields: [
      { id: 'name', name: 'name', label: 'Name', type: 'string' },
      { id: 'avatar', name: 'avatar', type: 'asset' },
    ],
  }),
];
const TYPE = { id: 'type-1', label: 'Teaser', fields: FIELDS };

const tree = (): DesignNode => ({
  id: 'root',
  el: 'stack',
  children: [
    { id: 'title', el: 'heading', bind: { field: 'title' } },
    {
      id: 'row',
      el: 'stack',
      children: [
        { id: 'text', el: 'text', props: { text: { en: 'Hello there' } } },
        { id: 'go', el: 'button', props: { text: { en: 'Go' } } },
      ],
    },
    {
      id: 'people',
      el: 'repeat',
      bind: { field: 'team' },
      children: [{ id: 'person', el: 'text', bind: { field: 'team.name' } }],
    },
    { id: 'link', el: 'link', children: [] },
  ],
});

const ids = (node: DesignNode | null | undefined): string[] =>
  (node?.children ?? []).map((child) => child.id);

describe('outline', () => {
  it('lists rows depth first with labels from names, fields and text', () => {
    const root = renameNode(tree(), 'row', 'Actions');
    const rows = outlineRows(root, (node) => nodeLabel(node, (path) => bindingLabel(FIELDS, path)));
    expect(rows.map((row) => [row.id, row.depth])).toEqual([
      ['root', 0],
      ['title', 1],
      ['row', 1],
      ['text', 2],
      ['go', 2],
      ['people', 1],
      ['person', 2],
      ['link', 1],
    ]);
    const label = (id: string) => rows.find((row) => row.id === id)?.label;
    expect(label('row')).toBe('Actions');
    expect(label('title')).toBe('Title');
    expect(label('person')).toBe('Team > Name');
    expect(label('text')).toBe('Hello there');
    expect(outlineRows(root, () => '', new Set(['row'])).map((row) => row.id)).not.toContain(
      'text',
    );
  });

  it('renames and clears a name without leaving empty props', () => {
    const named = renameNode(tree(), 'link', '  Card link ');
    expect(findNode(named, 'link')?.node.props).toEqual({ [LABEL_PROP]: 'Card link' });
    expect(findNode(renameNode(named, 'link', ''), 'link')?.node.props).toBeUndefined();
  });

  it('moves before, after and into a container by drop spot', () => {
    const root = tree();
    const after = dropSpot(root, 'people', 'after');
    const moved = placeNode(root, 'block', 'title', after!.parentId, after!.index);
    expect(ids(moved)).toEqual(['row', 'people', 'title', 'link']);
    const into = dropSpot(root, 'row', 'inside');
    expect(
      ids(findNode(placeNode(root, 'block', 'title', into!.parentId, into!.index)!, 'row')?.node),
    ).toEqual(['text', 'go', 'title']);
  });

  it('refuses drops that break nesting rules or repeat scopes', () => {
    const root = tree();
    // A button inside a link is invalid HTML.
    expect(placeNode(root, 'block', 'go', 'link', 0)).toBeNull();
    // Into its own subtree.
    expect(placeNode(root, 'block', 'row', 'text', 0)).toBeNull();
    // A text has no children.
    expect(placeNode(root, 'block', 'title', 'text', 0)).toBeNull();
    // `team.name` only resolves inside the repeat over `team`.
    expect(placeNode(root, 'block', 'person', 'root', 0)).toBeNull();
    // Chrome is for layouts.
    expect(canDropInto(root, 'block', { id: 'x', el: 'slot' }, 'root')).toBe(false);
    expect(canDropInto(root, 'layout', { id: 'x', el: 'slot' }, 'root')).toBe(true);
  });

  it('shifts, indents and outdents', () => {
    const root = tree();
    expect(ids(shiftNode(root, 'row', -1))).toEqual(['row', 'title', 'people', 'link']);
    expect(shiftNode(root, 'title', -1)).toBeNull();
    // The heading goes into the end of the stack before it.
    const indented = indentNode(root, 'block', 'people');
    expect(ids(findNode(indented!, 'row')?.node)).toEqual(['text', 'go', 'people']);
    const outdented = outdentNode(root, 'block', 'go');
    expect(ids(outdented)).toEqual(['title', 'row', 'go', 'people', 'link']);
  });

  it('inserts after the selection, into an empty container or at the end', () => {
    const root = tree();
    const heading = createNode('heading', 'new', { locale: 'en' });
    expect(insertSpot(root, 'block', heading, 'text')).toEqual({ parentId: 'row', index: 1 });
    expect(insertSpot(root, 'block', heading, null)).toEqual({ parentId: 'root', index: 4 });
    expect(insertSpot(root, 'block', createNode('text', 'n', { locale: 'en' }), 'link')).toEqual({
      parentId: 'link',
      index: 0,
    });
    // A button cannot go into the link, so it goes after it.
    expect(insertSpot(root, 'block', createNode('button', 'b', { locale: 'en' }), 'link')).toEqual({
      parentId: 'root',
      index: 4,
    });
  });

  it('builds elements for unplaced fields with free ids', () => {
    const node = nodeForField(
      field('gallery', 'asset', { multiple: true }),
      new Set(['f-gallery-list']),
    );
    expect(node).toMatchObject({
      el: 'repeat',
      id: 'f-gallery-list-2',
      bind: { field: 'gallery' },
    });
    expect(node?.children?.[0]).toMatchObject({ el: 'image', bind: { field: 'gallery.$item' } });
  });

  it('finds the node a validation path points at', () => {
    expect(nodeAtPath(tree(), 'root.children.2.children.0.bind.field')).toBe('person');
    expect(nodeAtPath(tree(), 'root.style.base.gap')).toBe('root');
  });

  it('names canvas nodes and reads them back only for its own design', () => {
    const ref = nodeRef('block', 'type-1', 'title');
    expect(nodeIdOf(ref, 'block', 'type-1')).toBe('title');
    expect(nodeIdOf(ref, 'block', 'type-2')).toBeNull();
    expect(nodeIdOf(null, 'block', 'type-1')).toBeNull();
  });
});

describe('binding picker', () => {
  const values = (el: Parameters<typeof bindingOptions>[1], repeats: string[] = []) =>
    bindingOptions(FIELDS, el, repeats).map((option) => option.value);

  it('offers the fields an element can show', () => {
    expect(values('image')).toEqual(['photo', 'gallery']);
    expect(values('heading')).toEqual(['title', 'body', 'cta', 'when']);
    expect(values('richtext')).toEqual(['title', 'body']);
    expect(values('repeat')).toEqual(['gallery', 'team']);
    expect(values('button')).toEqual(['title', 'photo', 'gallery', 'cta']);
  });

  it('adds sub-fields and list entries inside a repeat', () => {
    expect(values('text', ['team'])).toEqual(['title', 'body', 'cta', 'when', 'team.name']);
    expect(values('image', ['team', 'gallery'])).toEqual([
      'photo',
      'gallery',
      'team.avatar',
      'gallery.$item',
    ]);
    // A repeat does not walk the list it is already in.
    expect(values('repeat', ['gallery'])).toEqual(['team']);
  });

  it('reads the scope from the tree and resolves paths', () => {
    expect(repeatScope(tree(), 'person')).toEqual(['team']);
    expect(repeatScope(tree(), 'row')).toEqual([]);
    expect(fieldAtPath(FIELDS, 'team.avatar')?.field.type).toBe('asset');
    expect(fieldAtPath(FIELDS, 'gallery.$item')).toMatchObject({ item: true });
    expect(fieldAtPath(FIELDS, 'gone')).toBeNull();
  });

  it('lists every field for visibility conditions', () => {
    expect(bindingOptions(FIELDS, null, []).length).toBe(FIELDS.length);
  });

  it('reaches the fields of related documents by name inside a repeat', () => {
    const quote = { id: 'q1', name: 'quote', label: 'Quote', type: 'string', settings: {} };
    const fields = withRelated(
      [{ id: 'f1', name: 'items', type: 'content', settings: { types: ['t1'], multiple: true } }],
      (id) => (id === 't1' ? { fields: [quote] } : null),
    );
    expect(bindingOptions(fields, 'text', ['f1']).map((option) => option.value)).toEqual([
      'f1',
      'f1.$item',
      'f1.quote',
    ]);
    expect(fieldAtPath(fields, 'f1.quote')?.field.name).toBe('quote');
    expect(bindingLabel(fields, 'f1.quote')).toBe('items > Quote');
  });
});

describe('sample data', () => {
  it('fills every field by name with placeholder values', () => {
    const values = sampleFields(FIELDS);
    expect(typeof values.title).toBe('string');
    expect(values.photo).toBe(SAMPLE_IMAGE_ID);
    expect(values.gallery).toEqual([SAMPLE_IMAGE_ID, SAMPLE_IMAGE_ID, SAMPLE_IMAGE_ID]);
    expect(values.body).toMatchObject({ type: 'doc' });
    expect(values.cta).toMatchObject({ href: 'https://example.com' });
    expect(values.when).toBe('2026-03-14');
    expect(values.team).toHaveLength(3);
    expect((values.team as Array<Record<string, unknown>>)[0]).toMatchObject({
      avatar: SAMPLE_IMAGE_ID,
    });
    expect(sampleAssets()[SAMPLE_IMAGE_ID]?.url).toMatch(/^data:image\/svg\+xml,/);
  });

  it('finds stored blocks of a type anywhere in a document', () => {
    const doc = {
      body: {
        blocks: [
          { blockId: 'a', type: 'type-1', fields: { title: 'A' } },
          {
            blockId: 'b',
            type: 'other',
            fields: { inner: { blocks: [{ blockId: 'c', type: 'type-1', fields: {} }] } },
          },
        ],
      },
    };
    expect(findBlockInstances(doc, 'type-1').map((block) => block.blockId)).toEqual(['a', 'c']);
  });

  it('collects asset ids through repeaters', () => {
    const values = {
      photo: 'a1',
      gallery: ['a2', 'a3'],
      team: [{ avatar: 'a4' }, { avatar: null }],
    };
    expect(assetIdsIn(FIELDS, values).sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('builds a canvas input that renders the block with its draft', () => {
    const design = generateBlockDesign(TYPE);
    const input = blockCanvasInput({
      typeId: 'type-1',
      design,
      theme: defaultTheme(),
      space: { id: 's1', name: 'Acme', defaultLocale: 'en', locales: ['en'] },
      locale: 'en',
      contentTypes: {},
      fields: sampleFields(FIELDS),
      assets: sampleAssets(),
    });
    expect(input.mode).toBe('canvas');
    expect(input.blockDesigns['type-1']).toBe(design);
    expect(input.document?.typeId).toBe('type-1');
  });
});

describe('canvas resize', () => {
  const theme = defaultTheme();

  it('reads rem and px sizes', () => {
    expect(sizeToPx('2rem')).toBe(32);
    expect(sizeToPx('10px')).toBe(10);
    expect(sizeToPx('50%')).toBeNull();
  });

  it('snaps to a close container width and the nearest spacing step', () => {
    expect(resizeStyle({ width: 630, height: 70 }, theme, false)).toEqual({
      maxWidth: 'container:sm',
      minHeight: '4rem',
    });
  });

  it('keeps half rem steps when no container is close', () => {
    expect(resizeStyle({ width: 250 }, theme, false)).toEqual({ maxWidth: '15.5rem' });
  });

  it('keeps raw pixels in 4px steps in advanced mode', () => {
    expect(resizeStyle({ width: 251, height: 99 }, theme, true)).toEqual({
      width: '252px',
      minHeight: '100px',
    });
  });
});

describe('variants', () => {
  const base = (): BlockDesign => generateBlockDesign(TYPE);

  it('adds presets and copies with ids unique across variants', () => {
    let design = base();
    for (const start of ['generated', 'imageLeft', 'card', 'hero', 'centered', 'blank'] as const) {
      const variant = newVariant(design, TYPE, start, start);
      design = {
        ...design,
        variants: { ...design.variants, [variantName(start, design)]: variant },
      };
    }
    const copy = duplicateVariant(design, 'card');
    expect(copy?.name).toBe('card-copy');
    expect(validateSiteDesign('block', copy?.design).ok).toBe(true);
    const all = Object.values(copy!.design.variants).flatMap((variant) =>
      outlineRows(variant.root, () => '').map((row) => row.id),
    );
    expect(new Set(all).size).toBe(all.length);
    expect(designIds(copy!.design).size).toBe(all.length);
  });

  it('keeps the default variant', () => {
    const design = base();
    expect(removeVariant(design, 'default')).toBeNull();
    const added = {
      ...design,
      variants: { ...design.variants, extra: newVariant(design, TYPE, 'blank', 'Extra') },
    };
    expect(Object.keys(removeVariant(added, 'extra')?.variants ?? {})).toEqual(['default']);
  });

  it('makes unique variant names from labels', () => {
    const design = base();
    expect(variantName('Image left', design)).toBe('image-left');
    expect(variantName('Default', design)).toBe('default-2');
    expect(variantName('!!', design)).toBe('variant');
  });
});

describe('palette drags over the canvas', () => {
  it('reads the element kind from the drag types', () => {
    expect(paletteDragKind([PALETTE_TYPE, paletteKindType('richtext')])).toBe('richtext');
    expect(paletteDragKind([paletteKindType('text')])).toBeNull();
    expect(paletteDragKind(['Files'])).toBeNull();
  });
});
