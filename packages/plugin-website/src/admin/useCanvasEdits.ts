import type { BlockBreakpoint } from '@manablox/core';
import {
  type DesignNode,
  type ElementKind,
  isElementKind,
  nodeRef,
  type StyleRuleKey,
} from '@manablox/site';
import { computed, type Ref } from 'vue';
import { nodeIdOf } from './model/elements';
import { resizeStyle } from './model/resize';
import type { DesignerOptions } from './useDesigner';

/** Style rule a breakpoint edits. */
function ruleFor(breakpoint: BlockBreakpoint): StyleRuleKey {
  return breakpoint === 'desktop' ? 'base' : breakpoint;
}

/** What the canvas side of a designer calls on the tree. */
interface CanvasTarget {
  selectedId: Ref<string | null>;
  hoveredId: Ref<string | null>;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  move: (id: string, parentId: string, index: number) => void;
  insert: (kind: ElementKind, spot?: { parentId: string; index: number }) => boolean;
  remove: (id: string) => void;
  patch: (id: string, fn: (node: DesignNode) => DesignNode, group?: string) => void;
}

/**
 * The canvas side of a designer: the nodes it outlines, text typed and sizes dragged on it,
 * and handlers for `DesignCanvas`'s events, which name nodes by their canvas ref.
 */
export function useCanvasEdits(options: DesignerOptions, target: CanvasTarget) {
  const refOf = (id: string) => nodeRef(options.designKind, options.designKey(), id);
  const idOf = (ref: string | null) => nodeIdOf(ref, options.designKind, options.designKey());

  /** Nodes the canvas outlines: the selection and the hovered row. */
  const highlight = computed(() =>
    [target.selectedId.value, target.hoveredId.value]
      .filter((id, index, list): id is string => Boolean(id) && list.indexOf(id) === index)
      .map(refOf),
  );

  /** Static text typed on the canvas, for one locale. */
  function editText(id: string, text: string, locale: string) {
    target.patch(id, (node) => {
      const current = node.props?.text;
      const localized =
        current && typeof current === 'object' ? { ...(current as Record<string, string>) } : {};
      localized[locale || options.locale()] = text;
      return { ...node, props: { ...node.props, text: localized } };
    });
  }

  /** A canvas resize, snapped by `resizeStyle`, on the current breakpoint's rule. */
  function resize(id: string, size: { width?: number; height?: number }) {
    const theme = options.theme();
    if (!theme) return;
    const props = resizeStyle(size, theme, options.advanced());
    const rule = ruleFor(options.breakpoint());
    target.patch(id, (node) => {
      const current = { ...(node.style?.[rule] ?? {}) };
      // Only one of width and max width holds the size.
      if (props.width) delete current.maxWidth;
      if (props.maxWidth) delete current.width;
      return { ...node, style: { ...node.style, [rule]: { ...current, ...props } } };
    });
  }

  /** Handlers for `DesignCanvas`'s events. */
  const canvas = {
    selectNode: (ref: string | null) => target.select(idOf(ref)),
    hoverNode: (ref: string | null) => target.hover(idOf(ref)),
    moveNode: (ref: string, parent: string, index: number) => {
      const id = idOf(ref);
      const parentId = idOf(parent);
      if (id && parentId) target.move(id, parentId, index);
    },
    insertNode: (parent: string, index: number, element: string) => {
      const parentId = idOf(parent);
      if (parentId && isElementKind(element)) target.insert(element, { parentId, index });
    },
    removeNode: (ref: string) => {
      const id = idOf(ref);
      if (id) target.remove(id);
    },
    editText: (ref: string, text: string, locale: string, field: unknown) => {
      const id = idOf(ref);
      // Bound text is content, edited in the document.
      if (id && field === null) editText(id, text, locale);
    },
    resizeNode: (ref: string, size: { width?: number; height?: number }) => {
      const id = idOf(ref);
      if (id) resize(id, size);
    },
  };

  return { highlight, editText, resize, canvas };
}
