// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initForm } from '../src/islands/form.js';
import { initMenu } from '../src/islands/menu.js';
import { renderSitePage } from '../src/page.js';
import { contactType, renderInput } from './fixtures.js';
import { bareLayout } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

/** Server-rendered body markup, placed into the test document. */
async function mount(overrides: Parameters<typeof renderInput>[0] = {}) {
  const { html } = await renderSitePage(renderInput(overrides), { now: 1 });
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
  // The islands under test are initialised by hand.
  document.body.innerHTML = body.replace(/<script[^>]*><\/script>/g, '');
}

const key = (target: Element, name: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

describe('menu island', () => {
  it('toggles the mobile panel and closes on Escape and outside clicks', async () => {
    await mount();
    const nav = document.querySelector<HTMLElement>('nav.mb-menu') as HTMLElement;
    cleanups.push(initMenu(nav));
    const toggle = nav.querySelector('.mb-menu-toggle') as HTMLButtonElement;
    toggle.click();
    expect(nav.hasAttribute('data-open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    key(nav.querySelector('.mb-menu-link') as Element, 'Escape');
    expect(nav.hasAttribute('data-open')).toBe(false);
    expect(document.activeElement).toBe(toggle);
    toggle.click();
    document.body.click();
    expect(nav.hasAttribute('data-open')).toBe(false);
  });

  it('opens dropdowns from the keyboard and moves between items', async () => {
    await mount();
    const nav = document.querySelector<HTMLElement>('nav.mb-menu') as HTMLElement;
    cleanups.push(initMenu(nav));
    const [home, company] = [
      ...nav.querySelectorAll<HTMLElement>('.mb-menu-l0 > .mb-menu-item > .mb-menu-link'),
    ];
    expect(company?.getAttribute('aria-expanded')).toBe('false');
    expect(home?.hasAttribute('aria-expanded')).toBe(false);
    home?.focus();
    key(home as Element, 'ArrowRight');
    expect(document.activeElement).toBe(company);
    key(company as Element, 'ArrowDown');
    const item = company?.parentElement as HTMLElement;
    expect(item.hasAttribute('data-open')).toBe(true);
    expect(company?.getAttribute('aria-expanded')).toBe('true');
    const about = item.querySelector('.mb-menu-l1 .mb-menu-link');
    expect(document.activeElement).toBe(about);
    key(about as Element, 'Escape');
    expect(item.hasAttribute('data-open')).toBe(false);
    expect(document.activeElement).toBe(company);
  });

  it('enhances a menu once', async () => {
    await mount();
    const nav = document.querySelector<HTMLElement>('nav.mb-menu') as HTMLElement;
    cleanups.push(initMenu(nav));
    initMenu(nav);
    (nav.querySelector('.mb-menu-toggle') as HTMLButtonElement).click();
    expect(nav.hasAttribute('data-open')).toBe(true);
  });
});

describe('form island', () => {
  const page = {
    key: 't-page',
    design: {
      root: {
        id: 'form',
        el: 'form' as const,
        props: { databagTypeId: contactType.id },
        children: [
          { id: 'name', el: 'formField' as const, props: { fieldId: 'f-name' } },
          { id: 'send', el: 'formSubmit' as const },
          { id: 'msg', el: 'formMessage' as const },
        ],
      },
    },
  };

  it('submits by fetch and shows the success message', async () => {
    await mount({ page, layout: bareLayout });
    const form = document.querySelector('form') as HTMLFormElement;
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    cleanups.push(initForm(form));
    (form.querySelector('input[name="name"]') as HTMLInputElement).value = 'Ada';
    form.dispatchEvent(new SubmitEvent('submit', { cancelable: true, bubbles: true }));
    await vi.waitFor(() =>
      expect(form.querySelector('[data-mb-form-message]')?.hasAttribute('hidden')).toBe(false),
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/_manablox/forms/page/t-page/form');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('name')).toBe('Ada');
    expect(body.get('_mb_hp')).toBe('');
    expect(Number(body.get('_mb_elapsed'))).toBeGreaterThanOrEqual(0);
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
    const message = form.querySelector('[data-mb-form-message]') as HTMLElement;
    expect(message.textContent).toBe('Thank you!');
    expect(message.dataset.state).toBe('success');
    expect((form.querySelector('input[name="name"]') as HTMLInputElement).value).toBe('');
  });

  it('marks invalid fields and shows the error', async () => {
    await mount({ page, layout: bareLayout });
    const form = document.querySelector('form') as HTMLFormElement;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: false, message: 'Nope', errors: { name: 'Required' } }),
            { status: 422 },
          ),
      ),
    );
    cleanups.push(initForm(form));
    form.dispatchEvent(new SubmitEvent('submit', { cancelable: true, bubbles: true }));
    const message = form.querySelector('[data-mb-form-message]') as HTMLElement;
    await vi.waitFor(() => expect(message.dataset.state).toBe('error'));
    expect(message.textContent).toBe('Nope');
    expect(form.querySelector('input[name="name"]')?.getAttribute('aria-invalid')).toBe('true');
    expect((form.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
