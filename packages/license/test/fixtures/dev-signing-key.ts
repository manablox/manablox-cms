/**
 * A fixed key pair for this package's codec tests: the frozen lease needs a fixed key. It is
 * public, so it is never in `LICENSE_PUBLIC_KEYS`, and it is not published.
 */
export const DEV_KID = 'dev-2026-09';

export const DEV_PUBLIC_KEYS: Readonly<Record<string, string>> = {
  [DEV_KID]: 'e1C0pKqSGjaBACGzeLg5o3G8WBzaze8o4p-f2xtj0F0',
};

export const DEV_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIMvpAZ4h9NdrVlkcxBghXMyjqMESkpXmYcRaVYAlEMlv
-----END PRIVATE KEY-----
`;
