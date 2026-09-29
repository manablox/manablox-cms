import { describe, expect, it } from 'vitest';
import {
  type CheckedLease,
  checkLease,
  EXPIRING_SECONDS,
  entitlementOf,
  nextChange,
  type StoredLease,
} from '../src/server/services/license/state.js';
import { DAY, forgedLease, INSTANCE_ID, lease, T0, TRUSTED_KEYS } from './helpers/leases.js';

const stored = (token: string | null, extra: Partial<StoredLease> = {}): StoredLease => ({
  rowId: 'row',
  token,
  refreshFailed: false,
  conflict: false,
  ...extra,
});

const check = (token: string | null, now = T0, extra: Partial<StoredLease> = {}) =>
  checkLease(stored(token, extra), { now, instanceId: INSTANCE_ID, trustedKeys: TRUSTED_KEYS });

const ai = (leases: CheckedLease[], publicHostnames = true) =>
  entitlementOf('ai', leases, { publicHostnames });

describe('the state of a product', () => {
  it('is active for an active or trialing lease', () => {
    expect(ai([check(lease())])).toMatchObject({ state: 'active', kind: 'production' });
    expect(ai([check(lease({ status: 'trialing' }))]).state).toBe('active');
    const { periodEnd, exp } = ai([check(lease())]);
    expect(periodEnd?.getTime()).toBe((T0 + 30 * DAY) * 1000);
    expect(exp?.getTime()).toBe((T0 + 14 * DAY) * 1000);
  });

  it('is canceled while a scheduled cancellation is still paid, then grace', () => {
    const token = lease({ status: 'canceled', periodEnd: T0 + 5 * DAY, exp: T0 + 12 * DAY });
    expect(ai([check(token)]).state).toBe('canceled');
    expect(ai([check(token, T0 + 5 * DAY)]).state).toBe('canceled');
    expect(ai([check(token, T0 + 5 * DAY + 1)]).state).toBe('grace');
    expect(ai([check(token, T0 + 12 * DAY)]).state).toBe('lapsed');
  });

  it('is pastDue while the payment fails', () => {
    expect(ai([check(lease({ status: 'pastDue' }))]).state).toBe('pastDue');
  });

  it('is grace once the period ended and the lease still runs', () => {
    const token = lease({ periodEnd: T0 - DAY, exp: T0 + 13 * DAY });
    expect(ai([check(token)])).toMatchObject({ state: 'grace' });
  });

  it('is expiring close to the end when the last refresh failed', () => {
    const token = lease({ exp: T0 + 2 * DAY });
    expect(ai([check(token)]).state).toBe('active');
    expect(ai([check(token, T0, { refreshFailed: true })]).state).toBe('expiring');
    // Further away the failure changes nothing yet.
    expect(ai([check(lease({ exp: T0 + 4 * DAY }), T0, { refreshFailed: true })]).state).toBe(
      'active',
    );
  });

  it('is conflict when the server saw the activation twice, until the lease runs out', () => {
    const token = lease({ exp: T0 + 5 * DAY });
    expect(ai([check(token, T0, { conflict: true })]).state).toBe('conflict');
    expect(ai([check(token, T0 + 5 * DAY, { conflict: true })]).state).toBe('lapsed');
  });

  it('is lapsed once no valid lease names it any more', () => {
    const token = lease({ exp: T0 + DAY });
    expect(ai([check(token, T0 + DAY)])).toMatchObject({ state: 'lapsed', kind: null, exp: null });
    // A forged, foreign or not-yet-valid lease is no valid lease either.
    expect(ai([check(forgedLease())]).state).toBe('lapsed');
    expect(ai([check(lease({ iid: 'another-instance' }))]).state).toBe('lapsed');
    expect(ai([check(lease({ nbf: T0 + 60 }))]).state).toBe('lapsed');
  });

  it('is missing when no key ever covered it', () => {
    expect(ai([]).state).toBe('missing');
    expect(ai([check(null)]).state).toBe('missing');
    expect(ai([check(lease({ products: ['website'] }))]).state).toBe('missing');
    expect(ai([check('not.a.lease')]).state).toBe('missing');
  });

  it('takes the best state over every valid lease', () => {
    const failing = check(lease({ status: 'pastDue' }));
    const good = check(lease({ aid: 'act-2' }));
    expect(ai([failing, good]).state).toBe('active');
    expect(ai([check(lease({ exp: T0 + DAY }), T0 + DAY), failing]).state).toBe('pastDue');
  });

  it('covers a public instance with no development lease', () => {
    const development = check(lease({ kind: 'development' }));
    expect(ai([development], false)).toMatchObject({ state: 'active', kind: 'development' });
    expect(ai([development], true)).toMatchObject({
      state: 'missing',
      kind: 'development',
      reason: 'developmentOnPublicHost',
    });
    // A production lease beside it covers the public instance.
    expect(ai([development, check(lease({ aid: 'act-2' }))], true)).toMatchObject({
      state: 'active',
      kind: 'production',
    });
  });

  it('knows the next second a state changes on its own', () => {
    const checked = check(lease({ periodEnd: T0 + 30 * DAY, exp: T0 + 14 * DAY }));
    expect(nextChange([checked], T0)).toBe(T0 + 14 * DAY - EXPIRING_SECONDS);
    expect(nextChange([checked], T0 + 14 * DAY - EXPIRING_SECONDS)).toBe(T0 + 14 * DAY);
    expect(nextChange([check(lease({ nbf: T0 + 60 }))], T0)).toBe(T0 + 60);
    expect(nextChange([check(null)], T0)).toBeNull();
  });
});
