import { escapeHtml } from './util.js';

export interface CanvasPageOptions {
  /** URL of the canvas bundle, e.g. `/_site/canvas.3f2a1c.js`. */
  scriptSrc: string;
  /** Origin of the admin allowed to drive the canvas. */
  editorOrigin: string;
}

/** Element id the canvas bundle mounts into. */
export const CANVAS_ROOT_ID = 'mb-canvas';
/** Id of the JSON config the canvas bundle reads on load. */
export const CANVAS_CONFIG_ID = 'mb-canvas-config';

/**
 * The `/_manablox/canvas` document: an empty page that loads the canvas bundle, which then
 * renders whatever the editor sends. Serve it with `frame-ancestors <editorOrigin>`.
 */
export function renderCanvasPage(options: CanvasPageOptions): string {
  // `<` is escaped so the JSON cannot close its script element.
  const config = JSON.stringify({ editorOrigin: options.editorOrigin }).replace(/</g, '\\u003c');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    '<title>Canvas</title>',
    `<script type="application/json" id="${CANVAS_CONFIG_ID}">${config}</script>`,
    `<script type="module" src="${escapeHtml(options.scriptSrc)}"></script>`,
    '</head>',
    `<body><div id="${CANVAS_ROOT_ID}"></div></body>`,
    '</html>',
    '',
  ].join('\n');
}
