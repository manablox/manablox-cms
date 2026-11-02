import {
  connectPreview,
  insertionIndex,
  type PreviewDocument,
  type PreviewMessage,
} from '@manablox/live-preview';
import {
  type CanvasFocus,
  canContain,
  ELEMENT_KINDS,
  ELEMENTS,
  type ElementKind,
  isElementKind,
  MENU_CLASSES,
  type NodeRef,
  PALETTE_TYPE,
  paletteKindType,
  SCHEME_ATTRIBUTE,
  type SiteDesignKind,
  type SiteRenderInput,
  WEBSITE_CHANNEL,
  type WebsiteCanvasMessages,
} from '@manablox/site';
import { createApp, h, nextTick, shallowRef } from 'vue';
import { DesignRenderer } from '../body.js';
import { initMenu } from '../islands/menu.js';
import {
  type DesignFocus,
  ELEMENT_ATTRIBUTE,
  ISLAND_ATTRIBUTE,
  NODE_ATTRIBUTE,
  type RenderOptions,
} from '../types.js';
import { findDesignNode, parseNodeRef } from './design.js';
import { createOverlay } from './overlay.js';

export interface CanvasDesign {
  input: SiteRenderInput;
  css?: string;
  focus?: DesignFocus | null;
  readOnly?: boolean;
}

export interface CanvasOptions {
  /** Origin of the admin; messages from anywhere else are ignored. */
  editorOrigin: string;
  /** Sends to the editor. Defaults to the parent window. */
  post?: (message: PreviewMessage) => void;
  renderOptions?: RenderOptions;
  /** Rendered before the first `design` message. */
  initial?: CanvasDesign;
}

export interface Canvas {
  /** Renders a design, as a `design` message does. */
  setDesign(design: CanvasDesign): void;
  /** The selected node. */
  selected(): NodeRef | null;
  destroy(): void;
}

interface State {
  input: SiteRenderInput;
  focus: DesignFocus | null;
  readOnly: boolean;
}

const TEXT_ELEMENTS: readonly ElementKind[] = ['text', 'heading', 'button', 'link', 'formSubmit'];

function toFocus(value: CanvasFocus | DesignFocus | null | undefined): DesignFocus | null {
  if (!value || typeof value.kind !== 'string' || typeof value.key !== 'string') return null;
  const focus: DesignFocus = { kind: value.kind as SiteDesignKind, key: value.key };
  if (value.variant) focus.variant = value.variant;
  if (value.menu) focus.menu = value.menu;
  return focus;
}

/** Merges a content-editor draft into the rendered document. */
function withDocument(input: SiteRenderInput, doc: PreviewDocument): SiteRenderInput {
  const base = input.document ?? {
    id: doc.id ?? 'draft',
    localizationId: doc.id ?? 'draft',
    typeId: doc.typeId,
    title: '',
    permalink: null,
    publishedAt: null,
    fields: {},
  };
  return {
    ...input,
    document: { ...base, title: doc.title, permalink: doc.permalink, fields: doc.fields },
  };
}

/**
 * Mounts the canvas: renders what the editor sends with the site renderer, and in design mode
 * (a `focus` is set) lets the editor select, move, insert, remove, resize and retype nodes.
 */
export function mountCanvas(el: HTMLElement, options: CanvasOptions): Canvas {
  const doc = el.ownerDocument;
  const win = doc.defaultView as Window;
  const state = shallowRef<State | null>(null);
  const css = doc.createElement('style');
  css.id = 'mb-canvas-css';
  doc.head.appendChild(css);
  const overlay = createOverlay(doc);

  let selected: NodeRef | null = null;
  let hovered: NodeRef | null = null;
  let highlighted: NodeRef[] = [];
  let editing: { element: HTMLElement; ref: NodeRef; original: string } | null = null;
  let held: CanvasDesign | null = null;
  let drag: { ref: NodeRef | null; kind: ElementKind } | null = null;
  let resizing: { ref: NodeRef; x: number; y: number; width: number; height: number } | null = null;
  let frame = 0;

  // Content drafts and fields go through live-preview; design messages through its website channel.
  const connection = connectPreview({
    editorOrigin: options.editorOrigin,
    clickToEdit: true,
    plugins: [WEBSITE_CHANNEL],
    ...(options.post ? { post: options.post } : {}),
    onDocument: (document) => {
      const current = state.value;
      if (current) state.value = { ...current, input: withDocument(current.input, document) };
      void nextTick(schedule);
    },
  });
  const website = connection.plugin<WebsiteCanvasMessages>(WEBSITE_CHANNEL);
  type ToCanvas = WebsiteCanvasMessages['toPreview'];
  /** Skips payloads that are not objects. */
  const on = <K extends keyof ToCanvas>(name: K, handler: (payload: ToCanvas[K]) => void) =>
    website.on(name, (payload) => {
      if (typeof payload === 'object' && payload !== null) handler(payload);
    });

  const app = createApp({
    render: () => {
      const current = state.value;
      if (!current) return null;
      const renderOptions: RenderOptions = { ...options.renderOptions };
      if (current.focus) renderOptions.focus = current.focus;
      return h(DesignRenderer, {
        input: { ...current.input, mode: 'canvas' },
        options: renderOptions,
      });
    },
  });
  app.mount(el);

  const designMode = () => Boolean(state.value?.focus) && state.value?.focus?.kind !== 'theme';
  const editable = () => designMode() && !state.value?.readOnly;

  /** Whether a node belongs to the design being edited. */
  const selectable = (ref: string | null): ref is string => {
    const focus = state.value?.focus;
    const parsed = parseNodeRef(ref);
    return Boolean(focus && parsed && parsed.kind === focus.kind && parsed.key === focus.key);
  };

  const elementOf = (ref: NodeRef | null): HTMLElement | null =>
    ref ? doc.querySelector<HTMLElement>(`[${NODE_ATTRIBUTE}="${CSS.escape(ref)}"]`) : null;

  const pick = (target: EventTarget | null): NodeRef | null => {
    let element = target instanceof Element ? target.closest(`[${NODE_ATTRIBUTE}]`) : null;
    while (element) {
      const ref = element.getAttribute(NODE_ATTRIBUTE);
      if (selectable(ref)) return ref;
      element = element.parentElement?.closest(`[${NODE_ATTRIBUTE}]`) ?? null;
    }
    return null;
  };

  const kindOf = (ref: NodeRef | null): ElementKind | null => {
    const value = elementOf(ref)?.getAttribute(ELEMENT_ATTRIBUTE);
    return isElementKind(value) ? value : null;
  };

  const layout = () => {
    frame = 0;
    const rect = (ref: NodeRef | null) => elementOf(ref)?.getBoundingClientRect() ?? null;
    overlay.hover(hovered && hovered !== selected ? rect(hovered) : null);
    const kind = kindOf(selected);
    overlay.select(rect(selected), kind ?? '', editable() && kind !== null && kind !== 'slot');
    overlay.highlight(highlighted.map(rect).filter((entry): entry is DOMRect => entry !== null));
  };
  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(layout);
  };

  // Menus toggle like on the site; re-attached after every render, which may swap their parts.
  const menus = new Map<HTMLElement, () => void>();
  const attachMenus = () => {
    for (const cleanup of menus.values()) cleanup();
    menus.clear();
    for (const nav of el.querySelectorAll<HTMLElement>(`[${ISLAND_ATTRIBUTE}="menu"]`))
      menus.set(nav, initMenu(nav));
  };

  const apply = (design: CanvasDesign) => {
    css.textContent = design.css ?? css.textContent;
    state.value = {
      input: design.input,
      focus: toFocus(design.focus),
      readOnly: design.readOnly === true,
    };
    void nextTick(() => {
      attachMenus();
      schedule();
    });
  };

  const select = (ref: NodeRef | null) => {
    if (selected === ref) return;
    selected = ref;
    website.send('selectNode', { node: ref });
    schedule();
  };

  // Inline editing of static text.

  const finishEdit = (commit: boolean) => {
    if (!editing) return;
    const { element, ref, original } = editing;
    editing = null;
    element.removeAttribute('contenteditable');
    element.removeAttribute('data-mb-editing');
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!commit) element.textContent = original;
    else if (text !== original.trim())
      website.send('editText', {
        node: ref,
        text,
        locale: state.value?.input.locale ?? '',
        field: null,
      });
    if (held) {
      const next = held;
      held = null;
      apply(next);
    }
  };

  const startEdit = (ref: NodeRef) => {
    const input = state.value?.input;
    const found = input ? findDesignNode(input, ref) : null;
    const element = elementOf(ref);
    if (!found || !element || found.node.bind || !TEXT_ELEMENTS.includes(found.node.el)) return;
    if (found.node.children?.length) return;
    editing = { element, ref, original: element.textContent ?? '' };
    element.setAttribute('contenteditable', 'true');
    element.setAttribute('data-mb-editing', '');
    element.focus();
    const range = doc.createRange();
    range.selectNodeContents(element);
    const selection = win.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  // Drop targets for moves and palette inserts.

  const dropTarget = (x: number, y: number, kind: ElementKind, dragged: NodeRef | null) => {
    const input = state.value?.input;
    if (!input) return null;
    const draggedElement = elementOf(dragged);
    let candidate = doc.elementFromPoint(x, y)?.closest(`[${NODE_ATTRIBUTE}]`) ?? null;
    while (candidate) {
      const ref = candidate.getAttribute(NODE_ATTRIBUTE);
      const parentKind = candidate.getAttribute(ELEMENT_ATTRIBUTE);
      if (
        selectable(ref) &&
        isElementKind(parentKind) &&
        ELEMENTS[parentKind].container &&
        canContain(parentKind, kind) &&
        !draggedElement?.contains(candidate)
      )
        break;
      candidate = candidate.parentElement?.closest(`[${NODE_ATTRIBUTE}]`) ?? null;
    }
    if (!candidate) return null;
    const parent = candidate.getAttribute(NODE_ATTRIBUTE) as NodeRef;
    const seen = new Set<string>();
    const children = [...candidate.querySelectorAll<HTMLElement>(`[${NODE_ATTRIBUTE}]`)].filter(
      (child) => {
        const ref = child.getAttribute(NODE_ATTRIBUTE) as string;
        if (child.parentElement?.closest(`[${NODE_ATTRIBUTE}]`) !== candidate || seen.has(ref))
          return false;
        seen.add(ref);
        return true;
      },
    );
    const domIndex = insertionIndex(children, x, y);
    const tree = findDesignNode(input, parent)?.node.children ?? [];
    const before = children[domIndex];
    const beforeId = parseNodeRef(before?.getAttribute(NODE_ATTRIBUTE))?.id;
    const treeIndex = beforeId ? tree.findIndex((child) => child.id === beforeId) : -1;
    const index = treeIndex >= 0 ? treeIndex : tree.length;
    const anchor = (before ?? children[children.length - 1] ?? candidate).getBoundingClientRect();
    const top = before
      ? anchor.top
      : children.length
        ? anchor.bottom
        : anchor.top + anchor.height / 2;
    return { parent, index, line: { left: anchor.left, top, width: anchor.width } };
  };

  // Events.

  const onClick = (event: MouseEvent) => {
    if (overlay.owns(event.target)) return;
    const target = event.target as Element | null;
    if (!designMode()) {
      // Links and buttons must not navigate the canvas away.
      if (target?.closest('a[href]')) event.preventDefault();
      return;
    }
    if (editing?.element.contains(target)) return;
    if (editing) finishEdit(true);
    // A menu toggle still opens its panel, so the open state can be styled.
    if (!target?.closest(`.${MENU_CLASSES.toggle}`)) {
      event.preventDefault();
      event.stopPropagation();
    }
    select(pick(target));
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (!editable()) return;
    const ref = pick(event.target);
    if (!ref) return;
    event.preventDefault();
    startEdit(ref);
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (editing) {
      if (event.key === 'Escape') {
        event.preventDefault();
        finishEdit(false);
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        finishEdit(true);
      }
      return;
    }
    if (!designMode()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable]')) return;
    if (event.key === 'Escape' && selected) {
      event.preventDefault();
      select(null);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected && editable()) {
      event.preventDefault();
      website.send('removeNode', { node: selected });
    }
  };

  const onFocusout = (event: FocusEvent) => {
    if (editing && event.target === editing.element) finishEdit(true);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (resizing) {
      overlay.select(
        new DOMRect(
          elementOf(resizing.ref)?.getBoundingClientRect().left ?? 0,
          elementOf(resizing.ref)?.getBoundingClientRect().top ?? 0,
          Math.max(8, resizing.width + event.clientX - resizing.x),
          Math.max(8, resizing.height + event.clientY - resizing.y),
        ),
        kindOf(resizing.ref) ?? '',
        true,
      );
      return;
    }
    if (drag) {
      overlay.drop(dropTarget(event.clientX, event.clientY, drag.kind, drag.ref)?.line ?? null);
      return;
    }
    if (!designMode() || editing) return;
    const ref = pick(event.target);
    if (ref === hovered) return;
    hovered = ref;
    website.send('hoverNode', { node: ref });
    schedule();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (resizing) {
      const { ref, x, y, width, height } = resizing;
      resizing = null;
      overlay.dragging(false);
      website.send('resizeNode', {
        node: ref,
        width: Math.round(Math.max(1, width + event.clientX - x)),
        height: Math.round(Math.max(1, height + event.clientY - y)),
      });
      schedule();
      return;
    }
    if (!drag) return;
    const current = drag;
    drag = null;
    overlay.dragging(false);
    overlay.drop(null);
    const target = dropTarget(event.clientX, event.clientY, current.kind, current.ref);
    if (target && current.ref)
      website.send('moveNode', {
        node: current.ref,
        parent: target.parent,
        index: target.index,
      });
  };

  const onChipDown = (event: PointerEvent) => {
    const kind = kindOf(selected);
    if (!editable() || !selected || !kind) return;
    event.preventDefault();
    drag = { ref: selected, kind };
    overlay.dragging(true);
  };

  const onResizeDown = (event: PointerEvent) => {
    const rect = elementOf(selected)?.getBoundingClientRect();
    if (!editable() || !selected || !rect) return;
    event.preventDefault();
    resizing = {
      ref: selected,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
    };
    overlay.dragging(true);
  };

  const paletteKind = (event: DragEvent): ElementKind | null => {
    const types = [...(event.dataTransfer?.types ?? [])];
    if (!types.includes(PALETTE_TYPE)) return null;
    for (const kind of ELEMENT_KINDS) if (types.includes(paletteKindType(kind))) return kind;
    return null;
  };

  const onDragOver = (event: DragEvent) => {
    if (!editable()) return;
    const kind = paletteKind(event);
    const target = kind ? dropTarget(event.clientX, event.clientY, kind, null) : null;
    overlay.drop(target?.line ?? null);
    if (!target) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (event: DragEvent) => {
    overlay.drop(null);
    if (!editable()) return;
    const raw = event.dataTransfer?.getData(PALETTE_TYPE);
    const kind = isElementKind(raw) ? raw : null;
    const target = kind ? dropTarget(event.clientX, event.clientY, kind, null) : null;
    if (!kind || !target) return;
    event.preventDefault();
    website.send('insertNode', {
      parent: target.parent,
      index: target.index,
      element: kind,
    });
  };

  /** A palette drag the editor relays, for a canvas on another origin than the admin. */
  const relayedDrag = (phase: 'over' | 'drop' | 'leave', element: string, x: number, y: number) => {
    const kind = isElementKind(element) ? element : null;
    const target =
      phase !== 'leave' && kind && editable() && Number.isFinite(x) && Number.isFinite(y)
        ? dropTarget(x, y, kind, null)
        : null;
    overlay.drop(phase === 'over' ? (target?.line ?? null) : null);
    if (phase !== 'drop' || !kind || !target) return;
    website.send('insertNode', {
      parent: target.parent,
      index: target.index,
      element: kind,
    });
  };

  const onDragLeave = (event: DragEvent) => {
    if (!event.relatedTarget) overlay.drop(null);
  };

  const onSubmit = (event: Event) => event.preventDefault();

  const subscriptions = [
    on('design', (message) => {
      const design: CanvasDesign = {
        input: message.input as unknown as SiteRenderInput,
        css: message.css,
        focus: toFocus(message.focus),
        readOnly: message.readOnly === true,
      };
      if (editing) held = design;
      else apply(design);
    }),
    on('highlight', (message) => {
      highlighted = Array.isArray(message.nodes)
        ? message.nodes.filter((ref) => typeof ref === 'string')
        : [];
      schedule();
    }),
    on('breakpoint', (message) => {
      doc.documentElement.setAttribute('data-mb-breakpoint', message.breakpoint);
      schedule();
    }),
    on('scheme', (message) => {
      if (message.scheme === 'light' || message.scheme === 'dark') {
        doc.documentElement.setAttribute(SCHEME_ATTRIBUTE, message.scheme);
        schedule();
      }
    }),
    on('paletteDrag', (message) =>
      relayedDrag(message.phase, message.element, message.x, message.y),
    ),
  ];

  if (options.initial) apply(options.initial);

  doc.addEventListener('click', onClick, true);
  doc.addEventListener('dblclick', onDoubleClick, true);
  doc.addEventListener('keydown', onKeydown, true);
  doc.addEventListener('focusout', onFocusout, true);
  doc.addEventListener('pointermove', onPointerMove, true);
  doc.addEventListener('pointerup', onPointerUp, true);
  doc.addEventListener('dragover', onDragOver, true);
  doc.addEventListener('drop', onDrop, true);
  doc.addEventListener('dragleave', onDragLeave, true);
  doc.addEventListener('submit', onSubmit, true);
  overlay.chip.addEventListener('pointerdown', onChipDown);
  overlay.resize.addEventListener('pointerdown', onResizeDown);
  win.addEventListener('scroll', schedule, true);
  win.addEventListener('resize', schedule);

  return {
    setDesign: apply,
    selected: () => selected,
    destroy() {
      for (const unsubscribe of subscriptions) unsubscribe();
      connection();
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('dblclick', onDoubleClick, true);
      doc.removeEventListener('keydown', onKeydown, true);
      doc.removeEventListener('focusout', onFocusout, true);
      doc.removeEventListener('pointermove', onPointerMove, true);
      doc.removeEventListener('pointerup', onPointerUp, true);
      doc.removeEventListener('dragover', onDragOver, true);
      doc.removeEventListener('drop', onDrop, true);
      doc.removeEventListener('dragleave', onDragLeave, true);
      doc.removeEventListener('submit', onSubmit, true);
      win.removeEventListener('scroll', schedule, true);
      win.removeEventListener('resize', schedule);
      if (frame) win.cancelAnimationFrame(frame);
      for (const cleanup of menus.values()) cleanup();
      menus.clear();
      app.unmount();
      overlay.destroy();
      css.remove();
    },
  };
}
