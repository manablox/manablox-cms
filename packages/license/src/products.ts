/**
 * The products a license can grant, each unlocking one premium plugin. The AI + Website
 * bundle is a subscription plan that grants both, not a product of its own.
 */
export const PREMIUM_PRODUCTS = {
  ai: { plugin: 'ai', label: 'AI' },
  website: { plugin: 'website', label: 'Website' },
} as const;

export type PremiumProduct = keyof typeof PREMIUM_PRODUCTS;

/** The product ids, in catalogue order. */
export const PREMIUM_PRODUCT_IDS = Object.keys(PREMIUM_PRODUCTS) as [
  PremiumProduct,
  ...PremiumProduct[],
];
