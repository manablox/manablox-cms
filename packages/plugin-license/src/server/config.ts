import { LICENSE_PUBLIC_KEYS, parseLicenseKey } from '@manablox/license';
import type { LicenseKindSetting } from '../sdk.js';

/** The license server's API unless `server` or `MANABLOX_LICENSE_SERVER` names another. */
export const DEFAULT_LICENSE_SERVER = 'https://licenses.manablox.io/api';

/** `licensePlugin` options; each falls back to its environment variable. */
export interface LicensePluginOptions {
  /** License keys; `MANABLOX_LICENSE_KEYS`, a comma list. Keys added in the admin join them. */
  keys?: readonly string[];
  /** The license server's API; `MANABLOX_LICENSE_SERVER`. */
  server?: string;
  /** The customer portal; the server's origin without its `/api` path by default. */
  portal?: string;
  /** How the instance activates; `MANABLOX_LICENSE_KIND`, `auto` by default. */
  kind?: LicenseKindSetting;
  /** Preview hosts that count as private; `MANABLOX_LICENSE_DEV_HOSTS`, a comma list. */
  devHosts?: readonly string[];
  /**
   * Lease signing keys to trust besides the bundled ones, by `kid`: for tests and local
   * license servers. Never read from the environment.
   */
  trustedKeys?: Readonly<Record<string, string>>;
  /** The `fetch` the license server is called with; for tests. */
  fetch?: typeof fetch;
  /** The clock in milliseconds; for tests. */
  now?: () => number;
}

/** The options with their fallbacks applied. */
export interface LicenseConfig {
  /** Normalised keys, each once; malformed ones are in `malformed`. */
  keys: string[];
  malformed: string[];
  server: string;
  portal: string;
  kind: LicenseKindSetting;
  devHosts: string[];
  trustedKeys: Readonly<Record<string, string>>;
  fetch: typeof fetch;
  now: () => number;
}

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const KINDS: readonly LicenseKindSetting[] = ['auto', 'production', 'development'];

/** The portal of a server URL: its origin, or the URL without a trailing `/api`. */
export function portalOf(server: string): string {
  const url = new URL(server);
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api$/, '');
  return `${url.origin}${path}`;
}

/** The options over `env`; throws for a server URL or kind that cannot work. */
export function licenseConfig(
  options: LicensePluginOptions = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): LicenseConfig {
  const server = (options.server ?? env.MANABLOX_LICENSE_SERVER ?? DEFAULT_LICENSE_SERVER).replace(
    /\/+$/,
    '',
  );
  if (!URL.canParse(server)) throw new Error(`The license server is not a URL: ${server}`);
  const kind = options.kind ?? (env.MANABLOX_LICENSE_KIND as LicenseKindSetting | undefined);
  if (kind !== undefined && !KINDS.includes(kind)) {
    throw new Error(`MANABLOX_LICENSE_KIND is one of ${KINDS.join(', ')}, not ${kind}`);
  }
  const keys: string[] = [];
  const malformed: string[] = [];
  for (const raw of options.keys ?? list(env.MANABLOX_LICENSE_KEYS)) {
    const key = parseLicenseKey(raw);
    if (!key) malformed.push(raw);
    else if (!keys.includes(key)) keys.push(key);
  }
  return {
    keys,
    malformed,
    server,
    portal: (options.portal ?? portalOf(server)).replace(/\/+$/, ''),
    kind: kind ?? 'auto',
    devHosts: [...(options.devHosts ?? list(env.MANABLOX_LICENSE_DEV_HOSTS))].map((host) =>
      host.toLowerCase(),
    ),
    // A bundled `kid` cannot be replaced.
    trustedKeys: { ...options.trustedKeys, ...LICENSE_PUBLIC_KEYS },
    fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    now: options.now ?? Date.now,
  };
}
