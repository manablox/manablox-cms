/**
 * The lease signing keys this release trusts, by `kid`: raw Ed25519 public keys, base64url.
 * It holds the current key and the next one, so a rotation ships a release ahead of the
 * switch and old leases stay valid until they expire. Tests and local license servers pass
 * their own keys to `verifyLease`.
 */
export const LICENSE_PUBLIC_KEYS: Readonly<Record<string, string>> = {
  // The key the production license server signs with.
  'prod-1': 'GVu1NMotb0cj37m8KZn4s6XHpGU6jTzqsPzjH9RcUrU',
  // The next key: its private half waits in the secret store for the first rotation.
  'prod-2': 'p_N85Y9K1x_EbrcjaY0Ht4wdCgiTjWhOh_Fdylg8D5U',
};
