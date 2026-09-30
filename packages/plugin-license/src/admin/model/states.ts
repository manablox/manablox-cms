import type { LicenseKind, LicenseState } from '../../sdk';

/** A state's word and badge. */
export const STATE_BADGES: Record<LicenseState, { label: string; badge: string }> = {
  active: { label: 'Active', badge: 'mb-badge-ok' },
  canceled: { label: 'Ending', badge: 'mb-badge-warn' },
  pastDue: { label: 'Payment failed', badge: 'mb-badge-warn' },
  grace: { label: 'Not renewed', badge: 'mb-badge-warn' },
  expiring: { label: 'Cannot refresh', badge: 'mb-badge-danger' },
  conflict: { label: 'On another instance', badge: 'mb-badge-danger' },
  lapsed: { label: 'Lapsed', badge: 'mb-badge-danger' },
  missing: { label: 'No license', badge: 'mb-badge-danger' },
  development: { label: 'Development', badge: 'mb-badge-brand' },
};

export const KIND_LABELS: Record<LicenseKind, string> = {
  production: 'Production',
  development: 'Development',
  hosted: 'Hosted',
};

/** What a key's state means for its products, in one sentence. */
export const STATE_HINTS: Record<LicenseState, string> = {
  active: 'Everything it covers is unlocked.',
  canceled: 'The subscription ends with its period; renew it in the portal to keep the features.',
  pastDue: 'The last payment failed; update the payment method in the portal.',
  grace: 'The subscription was not renewed; the features lock when the lease runs out.',
  expiring: 'The license server has not answered; the features lock when the lease runs out.',
  conflict:
    'The license server saw this activation on another instance. Activate it here to move it.',
  lapsed: 'The lease ran out, so its products are locked.',
  missing: 'No key covers this product, so its features are locked.',
  development:
    'Runs without a license on this development instance, on private hosts only. A production instance needs a subscription.',
};
