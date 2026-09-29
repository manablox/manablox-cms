/** Plain DOM helpers shared by the block and inline overlays (no framework, no shadow DOM). */

/** Minimum distance of a floating element from the viewport edge. */
const MARGIN = 4;

/** Injects a stylesheet, returned so `destroy` can remove it. */
export function stylesheet(css: string): HTMLStyleElement {
  const style = window.document.createElement('style');
  style.textContent = css;
  window.document.head.appendChild(style);
  return style;
}

/** A child element of the overlay; `div`s start hidden until placed. */
export function child(parent: HTMLElement, tag: string, className: string): HTMLElement {
  const element = window.document.createElement(tag);
  if (className) element.className = className;
  if (tag === 'div') element.style.display = 'none';
  parent.appendChild(element);
  return element;
}

/** Wraps icon paths in a 24x24 `<svg>`. */
export function icon(paths: string): string {
  return `<svg viewBox="0 0 24 24">${paths}</svg>`;
}

export interface IconButtonOptions {
  /** The dataset key that names the button, e.g. `action` or `tool`. */
  key: string;
  value: string;
  label: string;
  icon: string;
  onClick?: (event: MouseEvent) => void;
}

/** An icon button whose label is both tooltip and accessible name. */
export function iconButton(
  parent: HTMLElement,
  { key, value, label, icon: markup, onClick }: IconButtonOptions,
): HTMLButtonElement {
  const element = window.document.createElement('button');
  element.type = 'button';
  element.dataset[key] = value;
  element.title = label;
  element.setAttribute('aria-label', label);
  element.innerHTML = markup;
  if (onClick) element.addEventListener('click', onClick);
  parent.appendChild(element);
  return element;
}

/** A decorative rule between button groups. */
export function separator(parent: HTMLElement): HTMLElement {
  const element = window.document.createElement('i');
  element.setAttribute('aria-hidden', 'true');
  parent.appendChild(element);
  return element;
}

export function place(
  element: HTMLElement,
  top: number,
  left: number,
  width: number,
  height: number,
): void {
  element.style.display = '';
  element.style.top = `${top}px`;
  element.style.left = `${left}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
}

export function show(element: HTMLElement): void {
  element.style.display = '';
}

export function hide(element: HTMLElement): void {
  element.style.display = 'none';
}

export interface BarPlacement {
  /** Distance above the rectangle. */
  gap: number;
  /** Placement when there is no room above: inside the top corner, or below. */
  fallback: 'inside' | 'below';
  /** Which end of the rectangle it aligns with. */
  align: 'start' | 'end';
}

/** Places a visible bar against a rectangle, kept on screen. The bar must already be shown. */
export function placeBar(bar: HTMLElement, rect: DOMRect, options: BarPlacement): void {
  const width = bar.offsetWidth;
  const height = bar.offsetHeight;
  const above = rect.top - height - options.gap;
  const fallback = options.fallback === 'inside' ? rect.top + MARGIN : rect.bottom + options.gap;
  const top = clamp(
    above >= MARGIN ? above : fallback,
    MARGIN,
    window.innerHeight - height - MARGIN,
  );
  const left = clamp(
    options.align === 'end' ? rect.right - width - MARGIN : rect.left,
    MARGIN,
    window.innerWidth - width - MARGIN,
  );
  bar.style.top = `${top}px`;
  bar.style.left = `${left}px`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}
