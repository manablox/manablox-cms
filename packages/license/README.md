# `@manablox/license`

License keys and signed leases for the Manablox premium plugins.

The license server, `@manablox/plugin-license` and the `manablox` CLI share this package.
It only reads and writes the formats; it decides nothing. Whether a feature is locked is
up to `@manablox/plugin-license`.

## Do I need to install it?

Usually not. The premium plugins install it for you. You only import it directly when you
build tooling around license keys.

## License keys

A key looks like `MBX-J06NP-P83GH-JX2NX-6ZWSQ-Z9ZDE`: 25 Crockford base32 symbols in groups
of five. 24 of them are random; the last one is a checksum, so a mistyped key is caught
before anything is sent over the network. The key is a secret and says nothing about what
it unlocks.

- `generateLicenseKey()`: a new random key. The license server uses it.
- `parseLicenseKey(input)`: the key in its canonical form, or `null` when it is not a key or
  has a typo. Case, spaces, dashes and the `MBX` prefix do not matter, and `O`, `I` and `L`
  are read as `0`, `1` and `1`.
- `keyId(key)`: the first group, which is safe to show in the admin, the CLI and the portal.

## Leases

A lease is what an instance gets back when it activates a key: a small signed token that
says which products the instance may use and until when. It is checked offline, against
public keys that ship with this package, so nothing on the request path calls the license
server.

- `verifyLease(token, publicKeys?, now?)`: `{ ok: true, lease }`, or `{ ok: false, reason }`
  with `reason` one of `malformed`, `unknownKid`, `badSignature`, `notYetValid` and
  `expired`. `publicKeys` defaults to `LICENSE_PUBLIC_KEYS`, `now` (unix seconds) to the
  current time.
- `signLease(payload, privateKey)`: signs a lease. The license server uses it.
- `leasePayloadSchema`: the payload's shape (version 1), as a zod schema.
- `generateSigningKeyPair()`: a new Ed25519 key pair for the license server's key tooling.
  The public key is in the form `LICENSE_PUBLIC_KEYS` holds.
- `LICENSE_PUBLIC_KEYS`: the trusted public keys by key id. A release carries the current
  key and the next one, so a key rotation needs no special update.

`PREMIUM_PRODUCTS` lists the products a lease can grant: `ai` and `website`.

## Private hostnames

A development activation counts for no seat, so it may only serve private hosts. The
instance and the license server decide that the same way:

- `isPrivateHostname(host, extraHosts?)`: true for `localhost` and names under
  `.localhost`, `.test`, `.local` and `.internal`, for loopback, RFC 1918, link-local and
  unique-local addresses, and for the `extraHosts` (hostnames, or `*.suffix`). `host` may be a
  hostname, a `Host` header with a port (`[::1]:3000` for IPv6) or a URL. An empty or
  unreadable host is public.
- `hostnameOf(value)`: the bare, lowercased hostname of such a value, `''` when there is none.

## Signing keys

`LICENSE_PUBLIC_KEYS` holds the production keys: `prod-1`, the key the license server signs
with, and `prod-2`, the next key for the first rotation. Tests and local license servers pass
their own public keys to `verifyLease`, and `@manablox/plugin-license` takes them as its
`trustedKeys` option in code, never from the environment; a bundled key id cannot be
overridden.
