import {
  BUTTON_CLASS,
  BUTTON_VARIANTS,
  buttonClass,
  CONTAINER_CLASS,
  type DesignNode,
  generateMenuDesign,
  INPUT_CLASS,
  LABEL_CLASS,
  PROSE_CLASS,
  type SiteRenderInput,
} from '@manablox/site';
import { defineComponent, h, type PropType, type VNodeChild } from 'vue';
import {
  createContext,
  type DataScope,
  type Frame,
  fieldDefs,
  type RenderContext,
} from './context.js';
import { menuDesignKeyOf, renderMenu } from './elements/chrome.js';
import { renderBlock } from './elements/data.js';
import { renderNode } from './renderer.js';
import type { RenderOptions } from './types.js';

/** The document's fields as the scope bindings read. */
export function documentScope(ctx: RenderContext): DataScope {
  const doc = ctx.input.document;
  const type = doc ? ctx.input.contentTypes?.[doc.typeId] : null;
  return {
    fields: doc?.fields ?? {},
    defs: fieldDefs(type),
    path: [],
    repeats: new Map(),
    document: true,
  };
}

function markersFor(ctx: RenderContext, kind: Frame['kind'], key: string): boolean {
  const focus = ctx.options.focus;
  return !focus || (focus.kind === kind && focus.key === key);
}

function notFoundBody(ctx: RenderContext): VNodeChild {
  return h('section', { class: 'mb-e-section' }, [
    h('div', { class: CONTAINER_CLASS }, [
      h('h1', 'Page not found'),
      h('p', [h('a', { href: '/' }, ctx.input.site?.name || ctx.input.space?.name || 'Home')]),
    ]),
  ]);
}

/** The page design inside the layout's `slot`. */
function pageBody(ctx: RenderContext): VNodeChild {
  const { input } = ctx;
  const data = documentScope(ctx);
  const pageRoot: DesignNode | undefined = input.page?.design?.root;
  const pageFrame: Frame = {
    kind: 'page',
    key: input.page?.key ?? 'page',
    data,
    markers: markersFor(ctx, 'page', input.page?.key ?? ''),
  };
  const page = () =>
    pageRoot && (input.document || ctx.canvas)
      ? renderNode(pageRoot, pageFrame, ctx)
      : notFoundBody(ctx);
  const layoutRoot = input.layout?.design?.root;
  if (!layoutRoot) return h('main', { id: 'main' }, [page()]);
  const layoutFrame: Frame = {
    kind: 'layout',
    key: input.layout.key,
    data,
    slot: page,
    markers: markersFor(ctx, 'layout', input.layout.key),
  };
  return renderNode(layoutRoot, layoutFrame, ctx);
}

/** A block alone, from sample values in the document's fields. */
function blockBody(ctx: RenderContext, key: string, variant: string | undefined): VNodeChild {
  const fields = ctx.input.document?.fields ?? {};
  return h('section', { class: 'mb-e-section' }, [
    h('div', { class: CONTAINER_CLASS }, [
      renderBlock({ blockId: 'sample', type: key, fields }, ctx, {
        render: renderNode,
        path: null,
        variant: variant ?? null,
      }),
    ]),
  ]);
}

/** The child of `root` whose subtree places a menu with this design, e.g. the header. */
function menuBand(root: DesignNode | undefined, key: string): DesignNode | null {
  const places = (node: DesignNode): boolean =>
    (node.el === 'menu' && menuDesignKeyOf(node) === key) || (node.children ?? []).some(places);
  if (!root || root.el === 'menu') return null;
  return (root.children ?? []).find(places) ?? null;
}

/**
 * A menu design where the layout places it, so it shows on that band's background; alone on
 * the page when no layout places it.
 */
function menuBody(ctx: RenderContext, key: string, menuName: string | undefined): VNodeChild {
  const layout = ctx.input.layout;
  const band = menuBand(layout?.design?.root, key);
  if (band && layout) {
    const frame: Frame = {
      kind: 'layout',
      key: layout.key,
      data: documentScope(ctx),
      markers: false,
    };
    return renderNode(band, frame, ctx);
  }
  const menus = ctx.input.menus ?? {};
  const menu = (menuName ? menus[menuName] : undefined) ?? Object.values(menus)[0] ?? null;
  const design = ctx.input.menuDesigns?.[key] ?? generateMenuDesign({ machineName: key });
  return h('section', { class: 'mb-e-section' }, [
    h('div', { class: CONTAINER_CLASS }, [
      renderMenu(
        menu,
        design,
        key,
        { class: [], 'data-mb-node': `menu:${key}:root` },
        ctx,
        `menu:${key}`,
      ),
    ]),
  ]);
}

/** Headings, text, buttons, inputs and prose with the theme's base styles. */
function styleGuide(): VNodeChild {
  const sample = 'The quick brown fox jumps over the lazy dog.';
  return h('section', { class: 'mb-e-section mb-style-guide' }, [
    h(
      'div',
      {
        class: [CONTAINER_CLASS, 'mb-e-stack'],
        style: 'gap:var(--mb-space-6,1.5rem);padding-block:var(--mb-space-10,2.5rem)',
      },
      [
        ...[1, 2, 3, 4, 5, 6].map((level) => h(`h${level}`, `Heading ${level}`)),
        h('p', sample),
        h('p', [h('a', { href: '#' }, 'A link in running text')]),
        h(
          'div',
          {
            class: 'mb-e-stack',
            style: 'flex-direction:row;flex-wrap:wrap;gap:var(--mb-space-3,0.75rem)',
          },
          BUTTON_VARIANTS.map((variant) =>
            h(
              'a',
              { class: [BUTTON_CLASS, buttonClass(variant)], href: '#' },
              `${variant[0]?.toUpperCase()}${variant.slice(1)} button`,
            ),
          ),
        ),
        h('div', { class: 'mb-e-form-field' }, [
          h('label', { class: LABEL_CLASS, for: 'mb-style-input' }, 'Label'),
          h('input', { class: INPUT_CLASS, id: 'mb-style-input', placeholder: 'Input' }),
        ]),
        h('div', {
          class: PROSE_CLASS,
          innerHTML: `<h2>Prose</h2><p>${sample} <strong>Bold</strong>, <em>italic</em> and <code>code</code>.</p><ul><li>First item</li><li>Second item</li></ul><blockquote><p>A quotation.</p></blockquote>`,
        }),
      ],
    ),
  ]);
}

/** The page body: layout and page, or the design the canvas focuses. */
export function renderBody(ctx: RenderContext): VNodeChild {
  const focus = ctx.options.focus;
  switch (focus?.kind) {
    case 'block':
      return blockBody(ctx, focus.key, focus.variant);
    case 'menu':
      return menuBody(ctx, focus.key, focus.menu);
    case 'theme':
      return styleGuide();
    default:
      return pageBody(ctx);
  }
}

/**
 * Renders a design tree for an input, the same markup as `renderSitePage`'s body. Used by the
 * canvas; islands and instance styles are not collected.
 */
export const DesignRenderer = defineComponent({
  name: 'DesignRenderer',
  props: {
    input: { type: Object as PropType<SiteRenderInput>, required: true },
    options: { type: Object as PropType<RenderOptions>, default: () => ({}) },
  },
  setup(props) {
    return () => renderBody(createContext(props.input, props.options));
  },
});
