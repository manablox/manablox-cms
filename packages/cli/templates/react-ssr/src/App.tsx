import { ManabloxAbortError } from '@manablox/public-sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createManablox } from './lib/manablox.js';
import { loadPage, type PageData } from './lib/load.js';
import { type AppState, PREVIEW_PATH } from './lib/state.js';
import { Page } from './pages/Page.js';
import { Preview } from './pages/Preview.js';

/**
 * The app both entries render. The server hands it the path it resolved and the data it
 * loaded; in the browser the same component navigates, which means one loader and one
 * render path for the first page and every one after it.
 */
export function App({ initial }: { initial: AppState }) {
  const client = useMemo(() => createManablox(initial.config), [initial.config]);
  const [path, setPath] = useState(initial.path);
  const [data, setData] = useState<PageData | null>(initial.data);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  // A navigation that superseded this one must not render over the newer page.
  const inFlight = useRef<AbortController | null>(null);

  const go = useCallback(
    async (next: string) => {
      setPath(next);
      if (next === PREVIEW_PATH) return;

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setPending(true);
      setError(null);
      try {
        const loaded = await loadPage(client, next);
        if (controller.signal.aborted) return;
        setData(loaded);
        document.title = loaded.page?.title ?? 'Not found';
      } catch (caught) {
        if (caught instanceof ManabloxAbortError || controller.signal.aborted) return;
        setError(caught);
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    },
    [client],
  );

  // A History API router: same-origin link clicks are intercepted, the back button works.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest('a');
      if (!anchor || (anchor.target && anchor.target !== '_self')) return;
      if (anchor.hasAttribute('download') || anchor.getAttribute('rel') === 'external') return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) {
        return;
      }
      event.preventDefault();
      if (href === location.pathname) return;
      history.pushState(null, '', href);
      void go(href);
    };
    const onPop = () => void go(location.pathname);

    document.addEventListener('click', onClick);
    addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('click', onClick);
      removeEventListener('popstate', onPop);
    };
  }, [go]);

  if (path === PREVIEW_PATH) {
    return (
      <div className="site">
        <main>
          <Preview editorOrigin={initial.config.editorOrigin} />
        </main>
      </div>
    );
  }

  return (
    <div className="site">
      <nav>
        {(data?.menu ?? []).map((item) => (
          // `item.href` is the URL for a link entry and the permalink for a content one,
          // so one anchor serves both; check `item.url` to tell them apart.
          <a
            key={item.id}
            href={item.href ?? '#'}
            aria-current={item.href === path ? 'page' : undefined}
            target={item.target === '_blank' ? '_blank' : undefined}
            rel={item.target === '_blank' ? 'noreferrer' : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <main aria-busy={pending}>
        <Page data={data} path={path} error={error} />
      </main>
    </div>
  );
}
