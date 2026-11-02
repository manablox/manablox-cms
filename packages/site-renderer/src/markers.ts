import { FIELD_ATTRIBUTE, LIST_ATTRIBUTE } from '@manablox/live-preview';
import type { RenderContext } from './context.js';
import type { MarkerPath } from './types.js';

/** Content markers are for the content visual editor: the canvas without a design focus. */
function marks(ctx: RenderContext, path: MarkerPath | null): path is MarkerPath {
  return ctx.canvas && !ctx.options.focus && path !== null && path.length > 0;
}

/** `data-manablox-field` for a bound element. */
export function fieldMarker(ctx: RenderContext, path: MarkerPath | null): Record<string, string> {
  return marks(ctx, path) ? { [FIELD_ATTRIBUTE]: path.join('.') } : {};
}

/** `data-manablox-list` for a block list. */
export function listMarker(ctx: RenderContext, path: MarkerPath | null): Record<string, string> {
  return marks(ctx, path) ? { [LIST_ATTRIBUTE]: path.join('.') } : {};
}
