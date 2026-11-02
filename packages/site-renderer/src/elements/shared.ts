import type { SiteDesignKind } from '@manablox/site';
import { h, type VNodeChild } from 'vue';
import type { RenderContext } from '../context.js';
import type { BaseAttrs } from '../renderer.js';
import { localize } from '../util.js';

/** Marks an element with nothing to show; the canvas labels it, a live page drops it. */
export const EMPTY_ATTRIBUTE = 'data-mb-empty';

/** In the canvas an empty, labelled element so it stays selectable; live, nothing. */
export function empty(
  ctx: RenderContext,
  attrs: BaseAttrs,
  tag: string,
  label: string,
): VNodeChild {
  return ctx.canvas ? h(tag, { ...attrs, [EMPTY_ATTRIBUTE]: label }) : null;
}

export function text(ctx: RenderContext, value: unknown): string {
  return localize(value, ctx.locale, ctx.input.space?.defaultLocale ?? ctx.locale);
}

/** Form post target of a node. */
export function formAction(
  ctx: RenderContext,
  kind: SiteDesignKind,
  key: string,
  nodeId: string,
): string {
  const base = (ctx.input.formActionBase || '/_manablox/forms').replace(/\/+$/, '');
  return `${base}/${kind}/${encodeURIComponent(key)}/${encodeURIComponent(nodeId)}`;
}

/** `rel` for a link opening in a new tab. */
export function relFor(target: string | undefined): string | undefined {
  return target === '_blank' ? 'noopener noreferrer' : undefined;
}
