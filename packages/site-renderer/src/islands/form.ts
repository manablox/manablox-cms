/**
 * Form island: submits by `fetch` and shows the result in the form's message element. Without
 * it the form posts normally and the site redirects back. The endpoint answers requests that
 * accept JSON with `{ ok, message?, redirect?, errors? }`.
 */

interface FormResponse {
  ok: boolean;
  message?: string;
  /** Where to go after success. */
  redirect?: string;
  /** Messages by field name. */
  errors?: Record<string, string>;
}

const READY = 'data-mb-ready';
/** Milliseconds between load and submit, for the minimum fill time. */
const ELAPSED = '_mb_elapsed';

function show(form: HTMLFormElement, ok: boolean, text?: string): void {
  const message = form.querySelector<HTMLElement>('[data-mb-form-message]');
  if (!message) return;
  message.textContent = text || (ok ? message.dataset.success : message.dataset.error) || '';
  message.dataset.state = ok ? 'success' : 'error';
  message.hidden = false;
}

function markErrors(form: HTMLFormElement, errors: Record<string, string> | undefined): void {
  for (const element of form.querySelectorAll('[aria-invalid]'))
    element.removeAttribute('aria-invalid');
  if (!errors) return;
  let first: HTMLElement | null = null;
  for (const name of Object.keys(errors)) {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLElement) {
      field.setAttribute('aria-invalid', 'true');
      first ??= field;
    }
  }
  first?.focus();
}

/** Enhances one form; returns a cleanup. */
export function initForm(form: HTMLFormElement): () => void {
  if (form.hasAttribute(READY)) return () => {};
  form.setAttribute(READY, '');
  const loaded = Date.now();
  let busy = false;

  const onSubmit = async (event: SubmitEvent) => {
    if (typeof fetch !== 'function') return;
    event.preventDefault();
    if (busy) return;
    busy = true;
    form.setAttribute('aria-busy', 'true');
    const buttons = [...form.querySelectorAll<HTMLButtonElement>('button[type="submit"]')];
    for (const button of buttons) button.disabled = true;
    const data = new FormData(form);
    data.set(ELAPSED, String(Date.now() - loaded));
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: new URLSearchParams(data as unknown as Record<string, string>),
        headers: { Accept: 'application/json', 'X-Requested-With': 'manablox-form' },
        credentials: 'same-origin',
      });
      const result = (await response.json().catch(() => null)) as FormResponse | null;
      const ok = response.ok && result?.ok === true;
      markErrors(form, ok ? undefined : result?.errors);
      if (ok && result?.redirect && /^\/(?!\/)/.test(result.redirect)) {
        window.location.assign(result.redirect);
        return;
      }
      show(form, ok, result?.message);
      if (ok) form.reset();
    } catch {
      show(form, false);
    } finally {
      busy = false;
      form.removeAttribute('aria-busy');
      for (const button of buttons) button.disabled = false;
    }
  };

  form.addEventListener('submit', onSubmit);
  return () => {
    form.removeEventListener('submit', onSubmit);
    form.removeAttribute(READY);
  };
}

function initForms(root: ParentNode = document): void {
  for (const form of root.querySelectorAll<HTMLFormElement>('form[data-mb-island="form"]'))
    initForm(form);
}

if (typeof document !== 'undefined') initForms();
