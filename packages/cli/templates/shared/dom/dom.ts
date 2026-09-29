/**
 * A few helpers instead of a framework. `el()` is shorthand for `createElement` plus a
 * dozen assignments, not an abstraction over the DOM.
 */
export type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    node.setAttribute(name, value);
  }

  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function replace(target: Element, ...children: Child[]): void {
  target.replaceChildren();
  append(target, children);
}
