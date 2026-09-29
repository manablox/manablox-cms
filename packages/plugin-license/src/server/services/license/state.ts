import {
  type LeasePayload,
  type LeaseRejection,
  leasePayloadSchema,
  type PremiumProduct,
  verifyLease,
} from '@manablox/license';
import type { LicenseKind, LicenseState } from '../../../sdk.js';

const DAY = 24 * 60 * 60;

/** A lease this close to its end, whose last refresh failed, is `expiring`. */
export const EXPIRING_SECONDS = 3 * DAY;

/** A product's entitlement: its state and the lease behind it. */
export interface Entitlement {
  product: PremiumProduct;
  state: LicenseState;
  /** The kind of the lease that decides; `null` without one. */
  kind: LicenseKind | null;
  /** The end of its paid or trial period. */
  periodEnd: Date | null;
  /** When its lease runs out. */
  exp: Date | null;
  /**
   * Why a product is locked beyond the state: `developmentOnPublicHost` (only a development
   * lease covers it, on an instance with a public hostname) or `unchecked` (it could not be
   * evaluated, so it counts as lapsed).
   */
  reason?: 'developmentOnPublicHost' | 'unchecked';
}

/** One stored lease with what its row says about it. */
export interface StoredLease {
  rowId: string;
  token: string | null;
  /** The last refresh failed. */
  refreshFailed: boolean;
  /** The license server saw the activation on another instance. */
  conflict: boolean;
}

/** A stored lease after verification. */
export interface CheckedLease extends StoredLease {
  /** The verified payload; `null` when the lease is not valid now. */
  lease: LeasePayload | null;
  rejected: LeaseRejection | 'otherInstance' | 'missing' | null;
  /** The payload as the token carries it, unverified: what it names, to tell `lapsed` from `missing`. */
  payload: LeasePayload | null;
  /** Its state when valid. */
  state: LicenseState | null;
}

export interface CheckContext {
  /** Unix seconds. */
  now: number;
  instanceId: string;
  trustedKeys: Readonly<Record<string, string>>;
}

/** The state a valid lease gives its products. */
function leaseState(
  lease: LeasePayload,
  stored: Pick<StoredLease, 'conflict' | 'refreshFailed'>,
  now: number,
): LicenseState {
  if (stored.conflict) return 'conflict';
  if (lease.exp - now < EXPIRING_SECONDS && stored.refreshFailed) return 'expiring';
  if (lease.status === 'pastDue') return 'pastDue';
  if (now > lease.periodEnd) return 'grace';
  // A scheduled cancellation: paid until the period end.
  if (lease.status === 'canceled') return 'canceled';
  return 'active';
}

/** A token's payload, without checking its signature. */
export function decodeLease(token: string): LeasePayload | null {
  try {
    const raw = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'));
    const parsed = leasePayloadSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Verifies a stored lease against the trusted keys and the instance. */
export function checkLease(stored: StoredLease, context: CheckContext): CheckedLease {
  if (!stored.token) {
    return { ...stored, lease: null, rejected: 'missing', payload: null, state: null };
  }
  const payload = decodeLease(stored.token);
  const verified = verifyLease(stored.token, context.trustedKeys, context.now);
  if (!verified.ok) {
    return { ...stored, lease: null, rejected: verified.reason, payload, state: null };
  }
  if (verified.lease.iid !== context.instanceId) {
    return { ...stored, lease: null, rejected: 'otherInstance', payload, state: null };
  }
  return {
    ...stored,
    lease: verified.lease,
    rejected: null,
    payload,
    state: leaseState(verified.lease, stored, context.now),
  };
}

/** Of two usable states, the one that asks less of anyone. */
const RANK: Partial<Record<LicenseState, number>> = {
  active: 0,
  canceled: 1,
  pastDue: 2,
  grace: 3,
  expiring: 4,
  conflict: 5,
};

const at = (seconds: number) => new Date(seconds * 1000);

/**
 * The best state over every valid lease that grants `product`. A development lease covers
 * nothing while the instance has a public hostname; without any valid lease the product is
 * `lapsed` when a stored lease once named it, else `missing`.
 */
export function entitlementOf(
  product: PremiumProduct,
  leases: readonly CheckedLease[],
  options: { publicHostnames: boolean },
): Entitlement {
  let best: CheckedLease | null = null;
  let development: CheckedLease | null = null;
  for (const checked of leases) {
    const { lease, state } = checked;
    if (!lease || !state || !lease.products.includes(product)) continue;
    if (lease.kind === 'development' && options.publicHostnames) {
      development ??= checked;
      continue;
    }
    const rank = RANK[state] ?? Number.POSITIVE_INFINITY;
    const bestRank = best?.state ? (RANK[best.state] ?? Number.POSITIVE_INFINITY) : Infinity;
    if (!best || rank < bestRank || (rank === bestRank && lease.exp > (best.lease?.exp ?? 0))) {
      best = checked;
    }
  }
  if (best?.lease && best.state) {
    return {
      product,
      state: best.state,
      kind: best.lease.kind,
      periodEnd: at(best.lease.periodEnd),
      exp: at(best.lease.exp),
    };
  }
  if (development?.lease) {
    return {
      product,
      state: 'missing',
      kind: 'development',
      periodEnd: at(development.lease.periodEnd),
      exp: at(development.lease.exp),
      reason: 'developmentOnPublicHost',
    };
  }
  const once = leases.some((checked) => checked.payload?.products.includes(product));
  return { product, state: once ? 'lapsed' : 'missing', kind: null, periodEnd: null, exp: null };
}

/**
 * The next second after `now` at which a lease's state may change on its own: it becomes
 * valid, its period ends, it nears its end or it runs out. `null` when none will.
 */
export function nextChange(leases: readonly CheckedLease[], now: number): number | null {
  let next: number | null = null;
  const consider = (second: number) => {
    if (second > now && (next === null || second < next)) next = second;
  };
  for (const { lease, payload, rejected } of leases) {
    if (lease) {
      consider(lease.periodEnd + 1);
      consider(lease.exp - EXPIRING_SECONDS);
      consider(lease.exp);
    } else if (payload && rejected === 'notYetValid') consider(payload.nbf);
  }
  return next;
}
