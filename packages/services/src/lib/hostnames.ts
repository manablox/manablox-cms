import { domainToASCII } from 'node:url';

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * A host name as stored: lower case, punycode, without scheme, port, path or trailing dot;
 * `null` when it is not a host name.
 */
export function normaliseHostname(input: string): string | null {
  let host = input.trim().toLowerCase();
  if (!host) return null;
  if (host.includes('://')) {
    if (!URL.canParse(host)) return null;
    host = new URL(host).hostname;
  }
  host = host.replace(/[/?#].*$/, '');
  // A bracketed IPv6 address keeps its colons.
  if (host.startsWith('['))
    return /^\[[0-9a-f:.]+\](:\d+)?$/.test(host) ? host.replace(/:\d+$/, '') : null;
  host = host.replace(/:\d*$/, '').replace(/\.$/, '');
  const ascii = domainToASCII(host);
  if (!ascii || ascii.length > 253) return null;
  return ascii.split('.').every((label) => LABEL.test(label)) ? ascii : null;
}
