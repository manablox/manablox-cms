/** Feature ceilings: read-only feature values plugins set above every scope. */

import type { FeatureKey } from './catalogue.js';
import type { AdminBanner, FeatureControl } from './types.js';

/**
 * What a plugin's `ceilings` returns. Its values are never stored; a feature it has off is off
 * at every scope, whatever they store. See https://dev.manablox.io/extending/controls/#feature-ceilings.
 */
export interface FeatureCeilingProvider {
  /** Read while resolving, so synchronous and cheap. A ceiling that is on changes nothing. */
  features(): ReadonlyMap<FeatureKey, FeatureControl>;
  /** Changes whenever `features` or `banners` does; resolved controls are kept per version. */
  version(): number;
  /** Instance banners the admin shows next to the control-set ones. */
  banners?(): AdminBanner[];
}

/** Every provider's values combined, at one version. */
export interface FeatureCeilingValues {
  /** `''` without providers. */
  version: string;
  /** The features some provider has off; the first such provider's value, in boot order. */
  features: ReadonlyMap<FeatureKey, FeatureControl>;
  banners: readonly AdminBanner[];
}

export const NO_CEILINGS: FeatureCeilingValues = Object.freeze({
  version: '',
  features: new Map(),
  banners: Object.freeze([]),
});

/** The providers of one process; the server adds each plugin's at boot. */
export class FeatureCeilings {
  private readonly providers: FeatureCeilingProvider[] = [];
  private combined: FeatureCeilingValues = NO_CEILINGS;

  add(provider: FeatureCeilingProvider): void {
    this.providers.push(provider);
  }

  /** The combined values, combined again only when a provider's version moved. */
  current(): FeatureCeilingValues {
    if (this.providers.length === 0) return NO_CEILINGS;
    const version = this.providers.map((provider) => provider.version()).join(':');
    if (version === this.combined.version) return this.combined;
    const features = new Map<FeatureKey, FeatureControl>();
    const banners: AdminBanner[] = [];
    for (const provider of this.providers) {
      for (const [key, value] of provider.features()) {
        if (!value.enabled && !features.has(key)) features.set(key, Object.freeze({ ...value }));
      }
      banners.push(...(provider.banners?.() ?? []));
    }
    this.combined = Object.freeze({ version, features, banners: Object.freeze(banners) });
    return this.combined;
  }
}
