import type { Breakpoint, ElementKind, SiteDesignKind } from './types.js';

/** The live-preview plugin channel between the admin designer and the site canvas. */
export const WEBSITE_CHANNEL = 'website';

/** A node of a design: `<designKind>:<designKey>:<nodeId>`. */
export type NodeRef = string;

/** `<designKind>:<designKey>:<nodeId>`, as the canvas names nodes. */
export function nodeRef(kind: SiteDesignKind, key: string, id: string): NodeRef {
  return `${kind}:${key}:${id}`;
}

/** Drag data type of a palette entry; the value is the element kind. */
export const PALETTE_TYPE = 'application/x-manablox-element';

/**
 * Also set by the palette, as `<PALETTE_TYPE>-<kind in lower case>`, because a drag's data
 * cannot be read before the drop but its types can.
 */
export function paletteKindType(kind: ElementKind): string {
  return `${PALETTE_TYPE}-${kind.toLowerCase()}`;
}

/** What the canvas shows: one design, or the page when absent. */
export interface CanvasFocus {
  kind: string;
  key: string;
  variant?: string | undefined;
  menu?: string | undefined;
}

/** The website channel's messages, per direction. */
export interface WebsiteCanvasMessages {
  toPreview: {
    /** Everything one render needs: `input` is a `SiteRenderInput`, `css` the drafts' stylesheet. */
    design: {
      input: Record<string, unknown>;
      css: string;
      focus?: CanvasFocus | null | undefined;
      /** Selection only: no moves, inserts, removals or edits. */
      readOnly?: boolean | undefined;
    };
    /** Nodes to outline. */
    highlight: { nodes: NodeRef[] };
    breakpoint: { breakpoint: Breakpoint };
    /** Forces the theme's light or dark colors. */
    scheme: { scheme: 'light' | 'dark' };
    /**
     * A palette drag relayed by the editor, as browsers do not deliver drags into a
     * cross-origin frame. `x`/`y` are the canvas' viewport coordinates.
     */
    paletteDrag: { phase: 'over' | 'drop' | 'leave'; element: string; x: number; y: number };
  };
  /** Requests the editor applies before sending the design back. */
  toEditor: {
    /** `null` clears the selection. */
    selectNode: { node: NodeRef | null };
    hoverNode: { node: NodeRef | null };
    /** `index` counts the parent's children before the move. */
    moveNode: { node: NodeRef; parent: NodeRef; index: number };
    /** `element` is the element kind dragged from the palette. */
    insertNode: { parent: NodeRef; index: number; element: string };
    removeNode: { node: NodeRef };
    /** Static text for `locale`, or the bound field's value when `field` is set. */
    editText: { node: NodeRef; text: string; locale: string; field: (string | number)[] | null };
    /** Sizes in CSS pixels; the editor snaps them to its size steps. */
    resizeNode: { node: NodeRef; width?: number | undefined; height?: number | undefined };
  };
}
