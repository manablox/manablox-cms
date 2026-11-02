import type { SiteSettingsDesign } from '@manablox/site';

/** The pattern the site uses while none is set. */
export const DEFAULT_TITLE_PATTERN = '{title} | {site}';
/** The site design validator's limit. */
const TITLE_PATTERN_MAX = 200;

const PLACEHOLDER = /\{([^{}]*)\}/g;
const KNOWN = new Set(['title', 'site']);

/** A page's `<title>` as the site renders it; the site name alone without a page title. */
export function titlePreview(pattern: string, title: string, site: string): string {
  if (!title) return site;
  if (!site) return title;
  return (pattern || DEFAULT_TITLE_PATTERN)
    .replace(/\{title\}/g, title)
    .replace(/\{site\}/g, site)
    .trim();
}

/** Hints for a title pattern; the site accepts any text up to the limit. */
export function titlePatternWarnings(pattern: string): string[] {
  const out: string[] = [];
  if (pattern.length > TITLE_PATTERN_MAX) {
    out.push(`Keep it under ${TITLE_PATTERN_MAX} characters.`);
  }
  if (!pattern.trim()) return out;
  const unknown = [...pattern.matchAll(PLACEHOLDER)]
    .map((match) => match[1] ?? '')
    .filter((name) => !KNOWN.has(name));
  if (unknown.length) {
    out.push(
      `${[...new Set(unknown)].map((name) => `{${name}}`).join(', ')} is not replaced; only {title} and {site} are.`,
    );
  }
  if (!pattern.includes('{title}')) {
    out.push('Without {title} every page has the same title in search results and tabs.');
  }
  return out;
}

/** The layout key a content type renders with. */
export const layoutOf = (site: SiteSettingsDesign, typeId: string): string =>
  site.layouts[typeId] ?? 'default';

/** `layouts` with one assignment changed; `default` needs no entry. */
export function withLayout(
  layouts: Record<string, string>,
  typeId: string,
  key: string,
): Record<string, string> {
  const { [typeId]: _dropped, ...rest } = layouts;
  return key === 'default' ? rest : { ...rest, [typeId]: key };
}

/** Localized text with one locale changed; an empty value drops the locale. */
export function withLocalized(
  text: Record<string, string> | undefined,
  locale: string,
  value: string,
): Record<string, string> | undefined {
  const { [locale]: _dropped, ...rest } = text ?? {};
  const next = value ? { ...rest, [locale]: value } : rest;
  return Object.keys(next).length ? next : undefined;
}

/** How the locale strategies behave, for the picker. */
export const LOCALE_STRATEGIES = [
  {
    value: 'prefix' as const,
    label: 'Path prefix',
    hint: 'One domain for all languages. The default language has no prefix (/about), the others start with their code (/de/about).',
  },
  {
    value: 'domain' as const,
    label: 'Domain per language',
    hint: 'Each language gets its own domain, pinned on the Domains page (example.de for German). Links and the language switch go to that domain; a language without one keeps the path prefix.',
  },
];
