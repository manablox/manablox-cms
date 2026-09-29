/**
 * A path as the server stores it: leading slash, no trailing slash, no repeated
 * slashes; `null` with a query, fragment or space, or without the leading slash.
 */
export function normaliseRedirectPath(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/') || /[?#\s]/.test(trimmed)) return null;
  const collapsed = trimmed.replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/$/, '') : collapsed;
}

const isAbsoluteUrl = (value: string): boolean => /^https?:\/\//i.test(value.trim());

export type RedirectStatus = 301 | 302;

export interface RedirectForm {
  fromPath: string;
  /** Where it points: a path or URL, or a document that follows its permalink. */
  target: 'path' | 'document';
  toPath: string;
  /** The document's `localizationId`. */
  toContentId: string | null;
  status: RedirectStatus;
  /** `null` answers in every locale. */
  locale: string | null;
}

export const emptyRedirectForm = (): RedirectForm => ({
  fromPath: '',
  target: 'path',
  toPath: '',
  toContentId: null,
  status: 301,
  locale: null,
});

/** A stored redirect as a form. */
export function redirectFormOf(row: {
  fromPath: string;
  toPath: string | null;
  toContentId: string | null;
  status: number;
  locale: string | null;
}): RedirectForm {
  return {
    fromPath: row.fromPath,
    target: row.toContentId ? 'document' : 'path',
    toPath: row.toPath ?? '',
    toContentId: row.toContentId,
    status: row.status === 302 ? 302 : 301,
    locale: row.locale,
  };
}

/** Field errors the server would give for the same form, keyed like its paths. */
export function redirectFormIssues(
  form: RedirectForm,
): Partial<Record<'fromPath' | 'toPath', string>> {
  const issues: Partial<Record<'fromPath' | 'toPath', string>> = {};
  const from = normaliseRedirectPath(form.fromPath);
  if (!form.fromPath.trim()) issues.fromPath = 'Enter the old path.';
  else if (!from) issues.fromPath = 'Start with / and leave out ?query and #fragment.';

  if (form.target === 'document') {
    if (!form.toContentId) issues.toPath = 'Pick the document to send visitors to.';
    return issues;
  }
  const to = form.toPath.trim();
  if (!to) issues.toPath = 'Enter a path like /new-page or a full https:// address.';
  else if (isAbsoluteUrl(to)) {
    if (!URL.canParse(to)) issues.toPath = 'That address is not a valid URL.';
  } else {
    const path = normaliseRedirectPath(to);
    if (!path) issues.toPath = 'Start with / or https://, and leave out spaces.';
    else if (from && path === from) issues.toPath = 'A redirect cannot point at its own path.';
  }
  return issues;
}

/** The create and update input of a valid form. */
export function redirectInput(form: RedirectForm) {
  return {
    fromPath: form.fromPath.trim(),
    toPath: form.target === 'path' ? form.toPath.trim() : null,
    toContentId: form.target === 'document' ? form.toContentId : null,
    status: form.status,
    locale: form.locale,
  };
}
