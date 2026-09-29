import { type Ref, ref } from 'vue';
import { onBeforeRouteUpdate } from 'vue-router';

/**
 * Pins the leaving page in place so it fades, not slides, while side columns move. The box
 * is measured in the route guard, before the columns change. Bind `main` to the scroller
 * and `pin` to the transition's `before-leave`.
 */
export function usePinnedLeave(): { main: Ref<HTMLElement | null>; pin: (el: Element) => void } {
  const main = ref<HTMLElement | null>(null);
  let leaving: { el: Element; box: DOMRect; view: DOMRect } | null = null;

  onBeforeRouteUpdate(() => {
    const el = main.value?.firstElementChild;
    leaving =
      el && main.value
        ? { el, box: el.getBoundingClientRect(), view: main.value.getBoundingClientRect() }
        : null;
  });

  function pin(el: Element): void {
    const node = el as HTMLElement;
    const host = node.parentElement;
    if (!host) return;
    const box = leaving?.el === el ? leaving.box : node.getBoundingClientRect();
    const view = leaving?.el === el ? leaving.view : host.getBoundingClientRect();
    leaving = null;
    const inset = [
      Math.max(0, view.top - box.top),
      Math.max(0, box.right - view.right),
      Math.max(0, box.bottom - view.bottom),
      Math.max(0, view.left - box.left),
    ];
    Object.assign(node.style, {
      position: 'fixed',
      top: `${box.top}px`,
      left: `${box.left}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      margin: '0',
      clipPath: `inset(${inset.map((v) => `${v}px`).join(' ')})`,
      pointerEvents: 'none',
    });
  }

  return { main, pin };
}
