import { CONTAINER_CLASS, containerClass, type StructureElement } from '@manablox/site';
import { h } from 'vue';
import type { ElementRenderer } from '../renderer.js';

/** Tags a structure element may render as through `props.as`. */
const BOX_TAGS = [
  'div',
  'article',
  'aside',
  'header',
  'footer',
  'main',
  'nav',
  'figure',
  'section',
];
const SECTION_TAGS = ['section', 'header', 'footer', 'main', 'aside', 'div', 'nav', 'article'];

export function tagOf(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

const box: ElementRenderer = ({ node, attrs, children }) =>
  h(tagOf(node.props?.as, BOX_TAGS, 'div'), attrs, children());

const section: ElementRenderer = ({ node, attrs, children }) => {
  const name = typeof node.props?.container === 'string' ? node.props.container : undefined;
  return h(tagOf(node.props?.as, SECTION_TAGS, 'section'), attrs, [
    h('div', { class: [CONTAINER_CLASS, name ? containerClass(name) : null] }, children()),
  ]);
};

export const structureElements: Record<StructureElement, ElementRenderer> = {
  box,
  stack: box,
  grid: box,
  section,
  spacer: ({ attrs }) => h('div', { ...attrs, 'aria-hidden': 'true' }),
  divider: ({ attrs }) => h('hr', attrs),
};
