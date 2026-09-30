/**
 * `@manablox/plugin-license/sdk`: the license states, the entries other plugins contribute
 * and the views the admin reads. Browser-safe.
 */

import type { FeatureKey, PluginContext } from '@manablox/core';
import type { PremiumProduct } from '@manablox/license';

/**
 * What a product's license allows now. `active`, `canceled` (paid until the period end, not
 * renewed after it), `pastDue`, `grace`, `expiring` and `conflict` lock nothing; `lapsed` and
 * `missing` switch the product's lapse set off. `development` locks nothing either: no valid
 * lease covers the product, but the instance is a development one (see the README), so it
 * runs without a license on private hosts.
 */
export type LicenseState =
  | 'active'
  | 'canceled'
  | 'pastDue'
  | 'grace'
  | 'expiring'
  | 'conflict'
  | 'lapsed'
  | 'missing'
  | 'development';

/** The states that lock a product's lapse set. */
export const LOCKED_STATES: readonly LicenseState[] = ['lapsed', 'missing'];

/** Who an activation counts against: a production seat, nothing, or a hosted instance. */
export type LicenseKind = 'production' | 'development' | 'hosted';

/**
 * The kind an instance activates as, and whether it counts as a development instance:
 * `auto` decides by `NODE_ENV` and its hostnames, `development` by its hostnames alone,
 * `production` never is one (see the README).
 */
export type LicenseKindSetting = 'auto' | 'production' | 'development';

/**
 * A `license.products` entry: the product a plugin sells and the features that switch off
 * while no license covers it. The keys are without `features.` and within the contributing
 * plugin's namespace (`plugins.<id>` or `plugins.<id>.<name>`).
 */
export interface LicenseProductEntry {
  product: PremiumProduct;
  lapse: readonly FeatureKey[];
}

/**
 * A `license.hostnames` entry: hostnames the contributing plugin serves beyond the configured
 * URLs, such as a website's domains. A development lease covers the instance only while every
 * one is private, and the instance is a development one only then. Called with the
 * contributing plugin's context; a throw counts as public.
 */
export interface LicenseHostnameEntry {
  hostnames(plugin: PluginContext): Promise<readonly string[]>;
}

/** Where a key came from: the environment (read-only here) or the admin. */
export type LicenseKeySource = 'environment' | 'admin';

/** A failure as a key row keeps it, from the license server or the network. */
export interface LicenseKeyError {
  /** An error key, `plugins.license.*`. */
  key: string;
  message: string;
  /** For `plugins.license.key.noSeats`: the production instances holding the seats. */
  activations?: LicenseSeatHolder[];
}

/** A production activation that holds a seat of a key, as the license server lists it. */
export interface LicenseSeatHolder {
  id: string;
  name: string | null;
  hostnames: string[];
  lastSeenAt: string | null;
}

/** One key of the instance, as Settings → Licenses shows it. Never the key itself. */
export interface LicenseKeyView {
  id: string;
  /** The key's first group. */
  keyId: string;
  source: LicenseKeySource;
  /** From the current lease; empty before the first activation. */
  products: Array<{ product: PremiumProduct; label: string }>;
  kind: LicenseKind | null;
  /** The key's own state; `null` while it has no lease. */
  state: LicenseState | null;
  /** ISO timestamps. */
  periodEnd: string | null;
  /** The lease is a trial's: `periodEnd` is when the trial ends. */
  trialing: boolean;
  leaseExpiresAt: string | null;
  refreshedAt: string | null;
  activated: boolean;
  /** Deactivated here; activating again takes a seat for production. */
  deactivated: boolean;
  error: LicenseKeyError | null;
}

/** A product's entitlement, as the admin shows it. */
export interface LicenseProductView {
  product: PremiumProduct;
  label: string;
  state: LicenseState;
  kind: LicenseKind | null;
  periodEnd: string | null;
  expiresAt: string | null;
  /** The portal's buy page with the product picked. */
  buyUrl: string;
}

/** Settings → Licenses. */
export interface LicenseOverview {
  keys: LicenseKeyView[];
  /** The products the configured plugins sell. */
  products: LicenseProductView[];
  /** The customer portal. */
  portal: string;
  /** Every key is a hosted one: Manablox Cloud manages the licenses, nothing changes here. */
  managed: boolean;
}
