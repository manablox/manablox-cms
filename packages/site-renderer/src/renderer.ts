import {
  type Breakpoint,
  classFor,
  type DesignNode,
  type ElementKind,
  elementClass,
  hasStyle,
  hiddenClass,
  isElementKind,
} from '@manablox/site';
import type { VNodeChild } from 'vue';
import { resolveField } from './bindings.js';
import { type Frame, nodeRef, type RenderContext } from './context.js';
import { chromeElements } from './elements/chrome.js';
import { contentElements } from './elements/content.js';
import { dataElements } from './elements/data.js';
import { formElements } from './elements/form.js';
import { structureElements } from './elements/structure.js';
import { ELEMENT_ATTRIBUTE, NODE_ATTRIBUTE } from './types.js';
import { isEmptyValue } from './values.js';

/** Attributes every element carries: classes, canvas markers. */
export interface BaseAttrs {
  class: Array<string | null | undefined | false>;
  style?: string | undefined;
  [attribute: string]: unknown;
}

/** Extra attributes a parent puts on a node's element, e.g. a block's grid placement. */
export interface NodeExtra {
  class?: Array<string | null | undefined | false>;
  style?: string | undefined;
  attrs?: Record<string, unknown>;
}

export interface ElementArgs {
  node: DesignNode;
  frame: Frame;
  ctx: RenderContext;
  attrs: BaseAttrs;
  /** Renders the node's children in `frame` (default: the node's frame). */
  children: (frame?: Frame) => VNodeChild[];
  render: typeof renderNode;
}

export type ElementRenderer = (args: ElementArgs) => VNodeChild;

const RENDERERS: Record<ElementKind, ElementRenderer> = {
  ...structureElements,
  ...contentElements,
  ...dataElements,
  ...formElements,
  ...chromeElements,
};

const BREAKPOINTS: Breakpoint[] = ['desktop', 'tablet', 'mobile'];

/** Renders one node and its subtree; `null` when it is hidden or has nothing to show. */
export function renderNode(
  node: DesignNode,
  frame: Frame,
  ctx: RenderContext,
  extra: NodeExtra = {},
): VNodeChild {
  if (!node || !isElementKind(node.el)) return null;
  const renderer = RENDERERS[node.el];

  const when = node.visibility?.whenField;
  if (typeof when === 'string' && when && isEmptyValue(resolveField(when, frame, ctx).value))
    return null;

  const shown = node.visibility?.breakpoints;
  const hidden = Array.isArray(shown)
    ? BREAKPOINTS.filter((breakpoint) => !shown.includes(breakpoint)).map(hiddenClass)
    : [];
  const attrs: BaseAttrs = {
    ...extra.attrs,
    class: [
      elementClass(node.el),
      hasStyle(node.style) ? classFor(frame.kind, frame.key, node.id) : null,
      ...hidden,
      ...(extra.class ?? []),
    ],
  };
  if (extra.style) attrs.style = extra.style;
  if (ctx.canvas && frame.markers) {
    attrs[NODE_ATTRIBUTE] = nodeRef(frame, node);
    attrs[ELEMENT_ATTRIBUTE] = node.el;
  }

  return renderer({
    node,
    frame,
    ctx,
    attrs,
    children: (childFrame = frame) =>
      (node.children ?? [])
        .map((child) => renderNode(child, childFrame, ctx))
        .filter((child) => child !== null && child !== undefined),
    render: renderNode,
  });
}
