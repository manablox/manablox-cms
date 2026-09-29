/** Body signatures: the HMAC of a request body under a shared secret. `signBody` makes one. */

/** HMAC algorithms a body signature may use, as named in a `prefixed` signature. */
export const SIGNATURE_ALGORITHMS = ['sha256', 'sha1', 'sha512'] as const;
export type SignatureAlgorithm = (typeof SIGNATURE_ALGORITHMS)[number];

/** `prefixed` is `<algorithm>=<hex>`; `hex` and `base64` are the bare digest. */
export const SIGNATURE_FORMATS = ['prefixed', 'hex', 'base64'] as const;
export type SignatureFormat = (typeof SIGNATURE_FORMATS)[number];

/**
 * The header Manablox signs outgoing bodies in, unless an endpoint names another. Its own
 * format, the default, is `sha256=<hex digest>` of the raw body.
 */
export const SIGNATURE_HEADER = 'x-manablox-signature';
