/**
 * Menu island: the mobile toggle (burger or off-canvas), dropdown keyboard handling, Escape,
 * and closing on outside clicks. State is `data-open` on the `nav` and on items.
 */

const OPEN = 'data-open';
const READY = 'data-mb-ready';

const setFlag = (element: Element, on: boolean) => {
  if (on) element.setAttribute(OPEN, '');
  else element.removeAttribute(OPEN);
};

function linkOf(item: Element | null): HTMLElement | null {
  return (item?.querySelector(':scope > .mb-menu-link') as HTMLElement | null) ?? null;
}

function subListOf(item: Element | null): HTMLElement | null {
  return (item?.querySelector(':scope > .mb-menu-list') as HTMLElement | null) ?? null;
}

/** Enhances one menu; returns a cleanup. */
export function initMenu(nav: HTMLElement): () => void {
  if (nav.hasAttribute(READY)) return () => {};
  nav.setAttribute(READY, '');
  const doc = nav.ownerDocument;
  const toggle = nav.querySelector<HTMLButtonElement>(':scope > .mb-menu-toggle');
  const panel = nav.querySelector<HTMLElement>(':scope > .mb-menu-panel');
  const offcanvas = nav.dataset.mbMobile === 'offcanvas';
  const popups = nav.dataset.mbPreset === 'dropdown' || nav.dataset.mbPreset === 'mega';

  // Links that open a submenu announce it.
  if (popups) {
    for (const item of nav.querySelectorAll('.mb-menu-l0 > .mb-menu-item')) {
      if (subListOf(item)) linkOf(item)?.setAttribute('aria-expanded', 'false');
    }
  }

  const setItem = (item: Element, open: boolean) => {
    setFlag(item, open);
    const link = linkOf(item);
    if (link?.hasAttribute('aria-expanded')) link.setAttribute('aria-expanded', String(open));
  };
  const closeItems = (except?: Element) => {
    for (const item of nav.querySelectorAll(`.mb-menu-item[${OPEN}]`))
      if (item !== except && !item.contains(except ?? null)) setItem(item, false);
  };
  const isOpen = () => nav.hasAttribute(OPEN);
  const setOpen = (open: boolean) => {
    setFlag(nav, open);
    toggle?.setAttribute('aria-expanded', String(open));
    if (open && offcanvas) linkOf(panel?.querySelector('.mb-menu-item') ?? null)?.focus();
    if (!open) closeItems();
  };

  const onToggle = () => setOpen(!isOpen());

  const onKeydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const item = target?.closest('.mb-menu-item') ?? null;
    if (event.key === 'Escape') {
      const openItem =
        item?.closest(`.mb-menu-item[${OPEN}]`) ?? nav.querySelector(`.mb-menu-item[${OPEN}]`);
      if (openItem) {
        setItem(openItem, false);
        linkOf(openItem)?.focus();
      } else if (isOpen()) {
        setOpen(false);
        toggle?.focus();
      } else return;
      event.preventDefault();
      return;
    }
    if (!item || !target?.classList.contains('mb-menu-link')) return;
    const list = item.parentElement;
    const topLevel = list?.classList.contains('mb-menu-l0') ?? false;
    const siblings = list
      ? [...list.children].map(linkOf).filter((link): link is HTMLElement => !!link)
      : [];
    const index = siblings.indexOf(target);
    const move = (step: number) => {
      const next = siblings[(index + step + siblings.length) % siblings.length];
      next?.focus();
      event.preventDefault();
    };
    if (topLevel && popups) {
      if (event.key === 'ArrowRight') return move(1);
      if (event.key === 'ArrowLeft') return move(-1);
      if (event.key === 'ArrowDown' && subListOf(item)) {
        closeItems(item);
        setItem(item, true);
        linkOf(subListOf(item)?.querySelector('.mb-menu-item') ?? null)?.focus();
        event.preventDefault();
      }
      return;
    }
    if (event.key === 'ArrowDown') return move(1);
    if (event.key === 'ArrowUp') {
      if (index === 0 && popups) {
        const parent = list?.closest('.mb-menu-item');
        if (parent) {
          setItem(parent, false);
          linkOf(parent)?.focus();
          event.preventDefault();
          return;
        }
      }
      return move(-1);
    }
  };

  // An item closes once focus leaves it.
  const onFocusout = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    for (const item of nav.querySelectorAll(`.mb-menu-item[${OPEN}]`))
      if (!next || !item.contains(next)) setItem(item, false);
  };

  const onDocumentClick = (event: MouseEvent) => {
    if (nav.contains(event.target as Node | null)) return;
    closeItems();
    if (isOpen()) setOpen(false);
  };

  toggle?.addEventListener('click', onToggle);
  nav.addEventListener('keydown', onKeydown);
  nav.addEventListener('focusout', onFocusout);
  doc.addEventListener('click', onDocumentClick);
  return () => {
    toggle?.removeEventListener('click', onToggle);
    nav.removeEventListener('keydown', onKeydown);
    nav.removeEventListener('focusout', onFocusout);
    doc.removeEventListener('click', onDocumentClick);
    nav.removeAttribute(READY);
  };
}

function initMenus(root: ParentNode = document): void {
  for (const nav of root.querySelectorAll<HTMLElement>('[data-mb-island="menu"]')) initMenu(nav);
}

if (typeof document !== 'undefined') initMenus();
