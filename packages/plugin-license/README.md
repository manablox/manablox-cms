# `@manablox/plugin-license`

License keys for the Manablox premium plugins, as a plugin:

- **Activations**: each license key is activated for the instance on the license server. The
  server answers with a signed lease: which products the instance may use, and until when.
- **Offline checks**: every process verifies the stored leases with the public keys that ship
  in `@manablox/license`. Nothing on the request path calls the license server.
- **Daily refresh**: the management worker refreshes a lease once it is a day old or ends
  within a week (the `license:refresh` maintenance task, every six hours), and rotates the
  refresh secret each time. Failures back off.
- **Locks, not lock-outs**: a product no valid lease covers has its lapse set switched off
  through a feature ceiling, shown with a lock and a buy link. Data stays, the server keeps
  booting, and a valid lease unlocks everything again.
- **Settings → Licenses**: superadmins see every key, refresh or deactivate it, add keys
  and open the portal.

The premium plugins require it; `manablox plugin install ai` or `website` installs it too.

## Install

```sh
npm install @manablox/plugin-license
```

## Usage

Add the plugin to every config that loads a premium plugin: the management config, and
the public and site configs where the website plugin runs.

```ts
import { defineConfig } from '@manablox/core';
import { licensePlugin } from '@manablox/plugin-license';

export default defineConfig({
  // database, auth, storage ...
  plugins: [licensePlugin() /* , aiPlugin(), websitePlugin() */],
});
```

Run `manablox migrate` afterwards: the baseline migration creates `license_activations`.
The table belongs to the instance, not to a space, so environments, space transfers and
snapshots leave it alone; a backup keeps it.

## Keys

Keys are secrets. Keep them in the environment, never in `manablox.config.ts`:

```sh
MANABLOX_LICENSE_KEYS=MBX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX,MBX-...
```

Keys added in the admin (Settings → Licenses) are stored in the database, encrypted with
the instance's `AUTH_SECRET`; keys from the environment show there as "from environment" and
are read-only. The instance's entitlements are the union of every key's lease.

| Option | Environment | Default | Meaning |
| --- | --- | --- | --- |
| `keys` | `MANABLOX_LICENSE_KEYS` | none | License keys, a comma list in the environment |
| `server` | `MANABLOX_LICENSE_SERVER` | `https://licenses.manablox.io/api` | The license server's API |
| `portal` | | the server's origin | The customer portal, for the buy and manage links |
| `kind` | `MANABLOX_LICENSE_KIND` | `auto` | `auto`, `production` or `development` |
| `devHosts` | `MANABLOX_LICENSE_DEV_HOSTS` | none | Preview hosts that count as private (`host` or `*.suffix`) |
| `trustedKeys` | | none | Lease signing keys to trust besides the bundled ones, for tests and local license servers. Code only, never the environment |

## The CLI

The plugin adds `manablox license <command>` (the full reference is in
`@manablox/cli`'s README):

```sh
manablox license buy --plugins ai,website --yearly   # buy in the portal; the key comes back
manablox license buy --plugins ai --trial --monthly  # lead with the trial
manablox license add MBX-XXXXX-...  --dev             # a key bought elsewhere
manablox license status                               # exit code 1 while a product is locked
manablox license activate [<keyId>] [--production]    # again, after a conflict or a restore
manablox license refresh
manablox license remove <keyId>
manablox license open [billing]
```

- `buy` shows the catalogue's prices (`GET /v1/catalog`), starts a CLI session
  (`POST /v1/cli-sessions`, with the instance id when the instance boots here), opens the
  portal's `/cli/<code>` page and polls with the poll token until the session is completed,
  expired or Ctrl-C stops it. The key comes with the first completed poll only; then it goes
  on as `add`. `--trial` asks the portal to lead with the trial (the server still decides
  whether one applies). Without a terminal it needs `--plugins` and `--monthly` or
  `--yearly`.
- `add` checks the key offline, puts it into `MANABLOX_LICENSE_KEYS` in `.env` (once) and
  activates it for this process with `licenses.addEnvironmentKey`. On `noSeats` it offers to
  free another instance's seat (`DELETE /v1/activations/:id` proven by the key) or to
  activate as development. The activation's name in the portal is `--name`, else the
  admin's hostname (without one the first public hostname) with the instance id's first 6
  characters, `localhost (3f9a2c)`, so that several local instances tell apart.
- `--no-activate` on `buy` and `add` only writes `.env`: the next boot's reconcile activates
  the key. `manablox create` uses it for a new instance.
- `buy` and `open` use `MANABLOX_LICENSE_SERVER`; the others the instance's own config.
- License errors are printed with their sentence and what to do, e.g. where in the portal.

## Development and production

`auto` activates as `development` when `NODE_ENV` is not `production` and every hostname of
the instance is private: its configured URLs (`server.publicUrl`, `server.adminUrl`,
`auth.baseUrl`), every space's URL and API hosts, and the hostnames plugins contribute (the
website's domains). Private are
`localhost`, names under `.localhost`, `.test`, `.local` and `.internal`, loopback,
RFC 1918, link-local and unique-local addresses, and `devHosts`.

A development activation takes no seat, but it only covers an instance whose hostnames are
all private, and `allowsHost(product, host)` refuses a public `Host`. The admin shows a
"Development license" notice.

## States

| State | Locks | Admin banner |
| --- | --- | --- |
| `active` | nothing | none |
| `canceled` | nothing, until the period ends | "subscription ends on" |
| `pastDue` | nothing | payment failed, link to billing |
| `grace` | nothing, until the lease runs out | the date the features lock |
| `expiring` | nothing, until the lease runs out | the license server cannot be reached |
| `conflict` | nothing, until the lease runs out | active on another instance |
| `lapsed` | the lapse set | needs a license, buy link |
| `missing` | the lapse set | add a key, buy link |

A refresh the license server answers with `activation.notFound` drops the lease at once: its
products lock unless another key covers them. The key stays; Refresh or Activate here (or
`manablox license activate`) activates it again.

## Hosted instances

Instances on Manablox Cloud hold platform keys, whose leases are `hosted`. While every key is
hosted, Settings → Licenses says "Managed by Manablox Cloud" and changes nothing, and the
admin shows no license banner but the lock of a lapsed or missing product.

## For premium plugins

A plugin names its product and the features that lock without it:

```ts
definePlugin({
  name: 'ai',
  requires: ['license'],
  contributions: {
    license: { products: [{ product: 'ai', lapse: ['plugins.ai'] }] },
  },
});
```

Lapse keys are the plugin's own features, without `features.`. A plugin that serves hostnames
of its own lists them for the development check:

```ts
contributions: {
  license: { hostnames: [{ hostnames: async (plugin) => listDomains(plugin.repos) }] },
},
```

Its services are `plugins.get('license')`:

- `entitlement(product)`: `{ product, state, kind, periodEnd, exp, reason? }`.
- `allowsHost(product, host)`: false for a public host while only a development lease covers
  the product.
- `licenses`: the `LicenseService` itself (activate, refresh, deactivate, reconcile, and
  for the CLI `addEnvironmentKey`, `removeEnvironmentKey` and `freeSeat`).

## Tests

`@manablox/plugin-license/testing` has `testLicensePlugin`, the plugin trusting a test
signing key and calling no license server. Before each process reads its leases it stores a
lease for the instance: both products and `production` by default,
`grant: { products, kind, status, days }` for another, `grant: false` for none.

It ships no key pair. `generateTestSigningKeys()` makes one at runtime (an Ed25519 pair from
`@manablox/license`'s `generateSigningKeyPair`), or pass your own
`{ kid, signingKey, publicKey }` (the private key as PKCS#8 PEM, the public key as raw
base64url). Generate one per test run and give the same pair to every process of one
instance; nothing signed with it verifies anywhere else.

```ts
import { generateTestSigningKeys, testLicensePlugin } from '@manablox/plugin-license/testing';

const signing = generateTestSigningKeys();

plugins: [testLicensePlugin({ signing }), websitePlugin()]; // licensed
plugins: [testLicensePlugin({ signing, grant: false }), websitePlugin()]; // lapsed
```

Processes that boot the same instance need the same pair. `signingToEnv(signing)` turns it
into environment variables (`MANABLOX_TEST_LICENSE_SIGNING`, the pair as base64url JSON) to
pass to a child process or a web server the test runner starts; there
`signingFromEnv()` reads it back (from `process.env`, or the object you pass; plain JSON
works too) and throws when it is missing. Nothing reads the variable on its own: only a
process that calls `testLicensePlugin({ signing: signingFromEnv() })` uses it.

```ts
// playwright.config.ts: one pair for every server of the run
const signing = generateTestSigningKeys();
webServer: [
  { command: 'pnpm start:licensed', env: { ...signingToEnv(signing) } },
  { command: 'pnpm site:licensed', env: { ...signingToEnv(signing) } },
];

// each server's entry
plugins: [testLicensePlugin({ signing: signingFromEnv() }), websitePlugin()];
```

This repository's admin e2e runs the API with it (`pnpm --filter @manablox/api start:licensed`,
or `dev:licensed` to work on licensing without a license server). It uses the pair
`MANABLOX_TEST_LICENSE_SIGNING` carries, else one it generates at startup.

## License

MIT, see `LICENSE`. The premium plugins that require this plugin are under their own
commercial license, which forbids circumventing or disabling their license checks, this
plugin's included.
