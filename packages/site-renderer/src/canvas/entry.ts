// The canvas bundle: mounts into the page `renderCanvasPage` serves.
import { CANVAS_CONFIG_ID, CANVAS_ROOT_ID } from '../canvas-page.js';
import { mountCanvas } from './index.js';

const root = document.getElementById(CANVAS_ROOT_ID);
const config = JSON.parse(document.getElementById(CANVAS_CONFIG_ID)?.textContent || '{}') as {
  editorOrigin?: unknown;
};
if (root && typeof config.editorOrigin === 'string')
  mountCanvas(root, { editorOrigin: config.editorOrigin });
