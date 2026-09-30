import type { AdminBanner, Contribution, FeatureControl, FeatureKey } from '@manablox/core';
import { PREMIUM_PRODUCTS, type PremiumProduct } from '@manablox/license';
import { type LicenseProductEntry, LOCKED_STATES } from '../../../sdk.js';
import type { Entitlement } from './state.js';

/** The portal's pages the messages link to. */
export interface PortalLinks {
  /** The buy page with the product picked. */
  buy(product: PremiumProduct): string;
  /** The subscriptions and billing. */
  manage: string;
}

export function portalLinks(portal: string): PortalLinks {
  return {
    buy: (product) => `${portal}/buy?products=${encodeURIComponent(product)}`,
    manage: `${portal}/subscriptions`,
  };
}

/** Each product's lapse set, joined over every plugin that sells it. */
export function lapseSets(
  contributions: readonly Contribution<LicenseProductEntry>[],
): Map<PremiumProduct, FeatureKey[]> {
  const sets = new Map<PremiumProduct, FeatureKey[]>();
  for (const { entry } of contributions) {
    const set = sets.get(entry.product) ?? [];
    for (const key of entry.lapse) if (!set.includes(key)) set.push(key);
    sets.set(entry.product, set);
  }
  return sets;
}

const labelOf = (product: PremiumProduct) => PREMIUM_PRODUCTS[product].label;
const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : 'soon');

/** Why a locked product is locked, as its features' lock message says it. */
function lockMessage(entitlement: Entitlement): string {
  const label = labelOf(entitlement.product);
  if (entitlement.reason === 'developmentOnPublicHost') {
    return `A public domain needs a production license for the ${label} plugin.`;
  }
  if (entitlement.reason === 'unchecked') return `The ${label} license could not be checked.`;
  if (entitlement.state === 'missing') return `Add a license key for the ${label} plugin.`;
  return `The ${label} plugin needs a license.`;
}

/** The lapse sets of locked products, switched off with the lock and a buy link. */
export function ceilingFeatures(
  entitlements: Iterable<Entitlement>,
  lapse: ReadonlyMap<PremiumProduct, readonly FeatureKey[]>,
  links: PortalLinks,
): Map<FeatureKey, FeatureControl> {
  const features = new Map<FeatureKey, FeatureControl>();
  for (const entitlement of entitlements) {
    if (!LOCKED_STATES.includes(entitlement.state)) continue;
    const off: FeatureControl = {
      enabled: false,
      presentation: 'locked',
      message: lockMessage(entitlement),
      link: links.buy(entitlement.product),
    };
    for (const key of lapse.get(entitlement.product) ?? []) {
      if (!features.has(key)) features.set(key, off);
    }
  }
  return features;
}

/**
 * The admin banners of the products' states, and the development notice while a product
 * runs on a development lease or without a license on a development instance. Hosted
 * licenses get none but the lock.
 */
export function ceilingBanners(
  entitlements: Iterable<Entitlement>,
  links: PortalLinks,
): AdminBanner[] {
  const banners: AdminBanner[] = [];
  let development = false;
  for (const entitlement of entitlements) {
    const { product, state } = entitlement;
    const label = labelOf(product);
    const banner = (
      level: AdminBanner['level'],
      text: string,
      link: string,
      dismissible: boolean,
    ) =>
      banners.push({
        id: `license.${product}.${state}`,
        level,
        text,
        link,
        dismissible,
        audience: 'superadmin',
      });
    const locked = LOCKED_STATES.includes(state);
    // Manablox Cloud manages hosted licenses: their admins hear only of a lock.
    if (!locked && entitlement.kind === 'hosted') continue;
    // A development lease, or none on a development instance: no production license covers it.
    if (state === 'development' || (!locked && entitlement.kind === 'development')) {
      development = true;
    }
    switch (state) {
      case 'canceled':
        banner(
          'warning',
          `Your ${label} subscription ends on ${day(entitlement.periodEnd)}.`,
          links.manage,
          true,
        );
        break;
      case 'pastDue':
        banner(
          'warning',
          `The payment for the ${label} license failed. Update the payment method to keep it.`,
          links.manage,
          true,
        );
        break;
      case 'grace':
        banner(
          'warning',
          `The ${label} license was not renewed. Its features lock on ${day(entitlement.exp)}.`,
          links.manage,
          true,
        );
        break;
      case 'expiring':
        banner(
          'danger',
          `The license server cannot be reached. The ${label} features lock on ${day(entitlement.exp)} unless a refresh gets through.`,
          links.manage,
          false,
        );
        break;
      case 'conflict':
        banner(
          'danger',
          `This ${label} license is active on another instance. Run manablox license activate here to move it; until ${day(entitlement.exp)} the features stay on.`,
          links.manage,
          false,
        );
        break;
      case 'lapsed':
      case 'missing':
        banner('danger', lockMessage(entitlement), links.buy(product), true);
        break;
      case 'active':
      case 'development':
        break;
    }
  }
  if (development) {
    banners.push({
      id: 'license.development',
      level: 'info',
      text: 'Development instance: the premium plugins run without a production license, on private hosts only.',
      dismissible: false,
      audience: 'all',
    });
  }
  return banners;
}
