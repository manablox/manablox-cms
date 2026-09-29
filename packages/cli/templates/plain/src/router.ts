export type Route = (path: string, signal: AbortSignal) => Promise<void> | void;

/**
 * A History-API router: it intercepts same-origin link clicks, keeps the back button
 * working, and aborts the request a previous navigation started. Without that last part a
 * fast double-navigation renders the first page over the second.
 */
export function createRouter(render: Route): { start: () => void; navigate: (to: string) => void } {
  let inFlight: AbortController | null = null;

  const run = (path: string) => {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    void render(path, controller.signal);
  };

  const navigate = (to: string) => {
    if (to === location.pathname) return;
    history.pushState(null, '', to);
    run(to);
  };

  const onClick = (event: MouseEvent) => {
    // Let the browser handle anything that is not a plain left-click on a local link.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = (event.target as HTMLElement | null)?.closest('a');
    if (!anchor) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download') || anchor.getAttribute('rel') === 'external') return;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) {
      return;
    }

    event.preventDefault();
    navigate(href);
  };

  return {
    start() {
      document.addEventListener('click', onClick);
      addEventListener('popstate', () => run(location.pathname));
      run(location.pathname);
    },
    navigate,
  };
}
