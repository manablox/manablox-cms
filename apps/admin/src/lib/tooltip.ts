/** Styled tooltips for every `title`; the text moves to `data-tip` to suppress the native one. */
const SHOW_DELAY = 150;
const GAP = 8;

let tip: HTMLDivElement | null = null;
let timer: number | null = null;
let current: HTMLElement | null = null;

function element(): HTMLDivElement {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.setAttribute('role', 'tooltip');
  tip.className =
    'mb-z-tooltip pointer-events-none fixed max-w-xs rounded-control bg-ink px-2.5 py-1.5 text-xs font-medium text-white shadow-pop transition-opacity duration-[var(--mb-dur-fast)] dark:bg-surface-100 dark:text-surface-900';
  tip.style.opacity = '0';
  tip.hidden = true;
  document.body.append(tip);
  return tip;
}

/** The tooltip text, moving `title` to `data-tip` on first read. */
function textFor(target: HTMLElement): string | null {
  const title = target.getAttribute('title');
  if (title !== null) {
    target.setAttribute('data-tip', title);
    target.removeAttribute('title');
    return title.trim() || null;
  }
  return target.getAttribute('data-tip')?.trim() || null;
}

function host(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  return node.closest<HTMLElement>('[title], [data-tip]');
}

function place(target: HTMLElement): void {
  const box = element();
  const rect = target.getBoundingClientRect();
  const width = box.offsetWidth;
  const height = box.offsetHeight;
  const left = Math.min(
    Math.max(GAP, rect.left + rect.width / 2 - width / 2),
    window.innerWidth - width - GAP,
  );
  // Above, or below when there is no room.
  const above = rect.top - height - GAP;
  const top = above >= GAP ? above : rect.bottom + GAP;
  box.style.left = `${Math.round(left)}px`;
  box.style.top = `${Math.round(top)}px`;
}

function show(target: HTMLElement): void {
  const text = textFor(target);
  if (!text) return;
  const box = element();
  box.textContent = text;
  box.hidden = false;
  place(target);
  box.style.opacity = '1';
  current = target;
}

function hide(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (!tip || tip.hidden) return;
  tip.style.opacity = '0';
  tip.hidden = true;
  current = null;
}

export function installTooltips(): void {
  document.addEventListener(
    'mouseover',
    (event) => {
      const target = host(event.target);
      if (!target || target === current) return;
      hide();
      // Strip the title before the native tooltip appears.
      if (!textFor(target)) return;
      timer = window.setTimeout(() => show(target), SHOW_DELAY);
    },
    true,
  );
  document.addEventListener(
    'mouseout',
    (event) => {
      const target = host(event.target);
      const next = host((event as MouseEvent).relatedTarget);
      if (target && target !== next) hide();
    },
    true,
  );
  document.addEventListener(
    'focusin',
    (event) => {
      const target = host(event.target);
      if (target) show(target);
    },
    true,
  );
  document.addEventListener('focusout', hide, true);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}
