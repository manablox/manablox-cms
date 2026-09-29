/** Fields that take typed values; checkboxes, radios and buttons are skipped. */
const FIELDS = [
  'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]):not([type=reset]):not([type=range]):not([type=color])',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="combobox"]',
].join(',');

function usable(element: HTMLElement): boolean {
  if (element.matches(':disabled, [readonly], [aria-disabled="true"]')) return false;
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  // Missing in some browsers and the test DOM.
  return typeof element.checkVisibility === 'function' ? element.checkVisibility() : true;
}

/** The field to focus under `root`; `[autofocus]` wins over document order. */
export function firstField(root: ParentNode): HTMLElement | null {
  const marked = root.querySelector<HTMLElement>('[autofocus]');
  if (marked && usable(marked)) return marked;
  for (const element of root.querySelectorAll<HTMLElement>(FIELDS)) {
    if (usable(element)) return element;
  }
  return null;
}

/** Focuses the first field under `root`. Returns whether there was one. */
export function focusFirstField(root: ParentNode): boolean {
  const field = firstField(root);
  if (!field) return false;
  // A dialog may still be animating in.
  field.focus({ preventScroll: true });
  return document.activeElement === field;
}

/**
 * `focusFirstField` that waits for lazily loaded inputs, giving up on the first key,
 * press, or after `within` ms. Returns whether a field had focus straight away.
 */
export function focusFirstFieldSoon(root: HTMLElement, within = 2000): boolean {
  if (focusFirstField(root)) return true;
  const observer = new MutationObserver(() => {
    if (focusFirstField(root)) stop();
  });
  const timer = setTimeout(stop, within);
  function stop() {
    observer.disconnect();
    clearTimeout(timer);
    document.removeEventListener('keydown', stop, true);
    document.removeEventListener('pointerdown', stop, true);
  }
  observer.observe(root, { childList: true, subtree: true });
  document.addEventListener('keydown', stop, true);
  document.addEventListener('pointerdown', stop, true);
  return false;
}
