/** Prefixes a root-relative media URL with the public origin; other URLs pass through. */
export function absoluteMediaUrl(url: string, base: string | undefined): string {
  if (!base) return url;
  if (!url.startsWith('/') || url.startsWith('//')) return url;
  return `${base.replace(/\/+$/, '')}${url}`;
}
