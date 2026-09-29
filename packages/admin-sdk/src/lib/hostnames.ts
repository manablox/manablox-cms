const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * The host name the server will store for `input`: lower case, punycode, without scheme,
 * port, path or trailing dot; `null` when it is not a host name. The server has the last word.
 */
export function previewHostname(input: string): string | null {
  let host = input.trim().toLowerCase();
  if (!host) return null;
  if (host.includes('://')) {
    if (!URL.canParse(host)) return null;
    host = new URL(host).hostname;
  }
  host = host.replace(/[/?#].*$/, '');
  if (host.startsWith('['))
    return /^\[[0-9a-f:.]+\](:\d+)?$/.test(host) ? host.replace(/:\d+$/, '') : null;
  host = host.replace(/:\d*$/, '').replace(/\.$/, '');
  if (!host || /[@\s]/.test(host)) return null;
  let ascii: string;
  try {
    ascii = new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
  if (ascii.length > 253) return null;
  return ascii.split('.').every((label) => LABEL.test(label)) ? ascii : null;
}
