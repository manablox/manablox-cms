/** The address's domain, lower-cased. */
export function domainOf(email: string): string {
  return email.trim().toLowerCase().split('@')[1] ?? '';
}

/** Whether the address belongs to one of the comma-separated domains or a subdomain. */
export function emailInDomains(email: string, domains: string): boolean {
  const domain = domainOf(email);
  if (!domain) return false;
  return domains
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .some((entry) => entry && (domain === entry || domain.endsWith(`.${entry}`)));
}

export const splitDomains = (domain: string): string[] =>
  domain
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
