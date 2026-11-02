import { type DesignSourceType, generateBlockDesign } from './generate.js';
import { walkNodes } from './tree.js';
import type { BlockVariant, DesignNode, StyleRules } from './types.js';
import { clone } from './util.js';

/** Starting points for a block variant, arranged from the type's fields. */
export const BLOCK_PRESETS = ['imageLeft', 'card', 'hero', 'centered'] as const;

export type BlockPreset = (typeof BLOCK_PRESETS)[number];

export const BLOCK_PRESET_LABELS: Record<BlockPreset, string> = {
  imageLeft: 'Image left',
  card: 'Card',
  hero: 'Hero',
  centered: 'Centered',
};

const MEDIA = new Set(['image', 'video']);

/** A media node, or a `repeat` showing media entries. */
function isMedia(node: DesignNode): boolean {
  if (MEDIA.has(node.el)) return true;
  return node.el === 'repeat' && (node.children ?? []).every((child) => MEDIA.has(child.el));
}

/** Renames ids taken elsewhere: `x`, else `x-2`, `x-3`, ...; `taken` grows. */
function withFreeIds(root: DesignNode, taken: Set<string>): DesignNode {
  walkNodes(root, ({ node }) => {
    let id = node.id;
    for (let n = 2; taken.has(id); n++) id = `${node.id}-${n}`.slice(0, 40);
    node.id = id;
    taken.add(id);
  });
  return root;
}

function styled(node: DesignNode, style: StyleRules): DesignNode {
  return { ...node, style: { ...node.style, ...style } };
}

/** Media without its own corners or width limits, filling its box. */
function fillMedia(node: DesignNode, aspect?: '16/9' | '4/3'): DesignNode {
  if (node.el === 'repeat') return node;
  return {
    ...node,
    style: {
      base: {
        width: '100%',
        ...(aspect ? { aspectRatio: aspect, objectFit: 'cover' as const } : {}),
      },
    },
  };
}

function headingsAs(nodes: DesignNode[], type: `type:${string}`): DesignNode[] {
  return nodes.map((node) =>
    node.el === 'heading'
      ? styled(node, { base: { ...node.style?.base, type } })
      : { ...node, ...(node.children ? { children: headingsAs(node.children, type) } : {}) },
  );
}

type Parts = { media: DesignNode[]; content: DesignNode[] };

const column = (when: boolean, node: DesignNode): DesignNode[] => (when ? [node] : []);

const LAYOUTS: Record<BlockPreset, (parts: Parts) => DesignNode> = {
  imageLeft: ({ media, content }) => ({
    id: 'root',
    el: 'stack',
    style: {
      base: { direction: 'row', align: 'center', gap: 'space:8' },
      mobile: { direction: 'column', align: 'stretch', gap: 'space:4' },
    },
    children: [
      ...column(media.length > 0, {
        id: 'media',
        el: 'stack',
        style: { base: { gap: 'space:4', width: '40%' }, mobile: { width: '100%' } },
        children: media.map((node) => fillMedia(node, '4/3')),
      }),
      {
        id: 'content',
        el: 'stack',
        style: { base: { gap: 'space:4', grow: true } },
        children: content,
      },
    ],
  }),
  card: ({ media, content }) => ({
    id: 'root',
    el: 'stack',
    style: {
      base: {
        background: 'color:surface',
        radius: 'radius:lg',
        shadow: 'shadow:md',
        overflow: 'hidden',
      },
    },
    children: [
      ...media.map((node) => fillMedia(node, '16/9')),
      {
        id: 'content',
        el: 'stack',
        style: { base: { gap: 'space:3', padding: 'space:6' }, mobile: { padding: 'space:4' } },
        children: content,
      },
    ],
  }),
  hero: ({ media, content }) => ({
    id: 'root',
    el: 'stack',
    style: {
      base: {
        align: 'center',
        textAlign: 'center',
        gap: 'space:6',
        paddingY: 'space:16',
        paddingX: 'space:6',
        background: 'color:surface',
      },
      mobile: { paddingY: 'space:10', paddingX: 'space:4' },
    },
    children: [
      {
        id: 'content',
        el: 'stack',
        style: { base: { gap: 'space:4', align: 'center', maxWidth: 'container:md' } },
        children: headingsAs(content, 'type:4xl'),
      },
      ...media.map((node) => fillMedia(node)),
    ],
  }),
  centered: ({ media, content }) => ({
    id: 'root',
    el: 'stack',
    style: { base: { align: 'center', textAlign: 'center', gap: 'space:4' } },
    children: [
      ...media.map((node) => fillMedia(node)),
      {
        id: 'content',
        el: 'stack',
        style: { base: { gap: 'space:4', align: 'center', maxWidth: 'container:sm' } },
        children: content,
      },
    ],
  }),
};

/**
 * A variant of a block type laid out as `preset`, showing every field the generated design
 * shows. Ids avoid `taken` (ids of other variants: they share one namespace).
 */
export function generateBlockPreset(
  type: DesignSourceType,
  preset: BlockPreset,
  options: { taken?: Iterable<string> } = {},
): BlockVariant {
  const generated = generateBlockDesign(type).variants.default as BlockVariant;
  const children = clone(generated.root.children ?? []);
  const parts: Parts = {
    media: children.filter(isMedia),
    content: children.filter((node) => !isMedia(node)),
  };
  const root = withFreeIds(LAYOUTS[preset](parts), new Set(options.taken));
  return { label: BLOCK_PRESET_LABELS[preset], root };
}
