const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$|\.(test|localhost)$/;

const isLocalHostname = (hostname: string): boolean => LOCAL.test(hostname);

/**
 * Where a domain opens: https, or plain http for a local name, then on the site process's
 * port when `siteUrl` is local too.
 */
export function domainUrl(hostname: string, siteUrl: string | null | undefined): string {
  if (!isLocalHostname(hostname)) return `https://${hostname}`;
  let port = '';
  if (siteUrl && URL.canParse(siteUrl)) {
    const site = new URL(siteUrl);
    if (isLocalHostname(site.hostname)) port = site.port;
  }
  return `http://${hostname}${port ? `:${port}` : ''}`;
}

export interface DomainForm {
  hostname: string;
  /** `null` serves every locale by path prefix. */
  locale: string | null;
  isPrimary: boolean;
  redirectToPrimary: boolean;
}

/** The domain a primary host of the same locale would replace, for the dialog's warning. */
export function currentPrimary<T extends { id: string; locale: string | null; isPrimary: boolean }>(
  domains: readonly T[],
  locale: string | null,
  exceptId: string | null,
): T | null {
  return (
    domains.find((row) => row.isPrimary && row.locale === locale && row.id !== exceptId) ?? null
  );
}
