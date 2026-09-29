import { randomUUID } from 'node:crypto';
import {
  generateLicenseKey,
  keyId,
  type LeasePayload,
  type PremiumProduct,
  signLease,
} from '@manablox/license';
import { DAY, TEST_KID, TEST_PRIVATE_KEY } from './leases.js';

export const FAKE_SERVER = 'https://licenses.test/api';

/** What a key's subscription holds. */
export interface FakeSubscription {
  products: PremiumProduct[];
  /** Production seats. */
  quantity: number;
  status: LeasePayload['status'];
  /** Unix seconds. */
  periodEnd: number;
  revoked?: boolean;
  /** A platform key of a hosted instance: its activations are `hosted`, whatever is asked. */
  hosted?: boolean;
}

export interface FakeActivation {
  id: string;
  key: string;
  instanceId: string;
  kind: 'production' | 'development' | 'hosted';
  name: string | null;
  hostnames: string[];
  versions: Record<string, string>;
  secret: string;
  /** The secret before the last rotation, accepted until `until` (ms). */
  previous: { secret: string; until: number } | null;
  conflictAt: number | null;
  deactivated: boolean;
  lastSeenAt: number;
}

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

/** A `manablox license buy` session, as the portal would complete it. */
export interface FakeCliSession {
  id: string;
  code: string;
  pollToken: string;
  products: string[];
  interval: string;
  instanceId: string | null;
  trial: boolean;
  status: 'pending' | 'completed' | 'expired';
  key: string | null;
  delivered: boolean;
}

/** The catalogue `GET /v1/catalog` answers: the bundle has no price. */
const FAKE_CATALOG = {
  products: [
    { id: 'ai', label: 'AI' },
    { id: 'website', label: 'Website' },
  ],
  plans: [
    {
      id: 'ai-month',
      grants: ['ai'],
      interval: 'month',
      trialDays: 14,
      price: { amount: '1900', currency: 'EUR', formatted: '€19.00' },
    },
    {
      id: 'website-month',
      grants: ['website'],
      interval: 'month',
      trialDays: 14,
      price: { amount: '2900', currency: 'EUR', formatted: '€29.00' },
    },
    { id: 'bundle-year', grants: ['ai', 'website'], interval: 'year', trialDays: 0, price: null },
  ],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failure = (status: number, code: string, details?: Record<string, unknown>) =>
  json(status, { error: { code, message: code, ...(details ? { details } : {}) } });

/**
 * The license server's instance API as the contract has it, in memory: activations with seats,
 * leases signed with the test key, refresh secrets rotated with a ten-minute overlap, clone
 * detection and deactivation by secret or by key. `clock.now` is milliseconds.
 */
export function fakeLicenseServer(clock: { now: number }) {
  const keys = new Map<string, FakeSubscription>();
  const activations = new Map<string, FakeActivation>();
  const calls: Call[] = [];
  const sessions = new Map<string, FakeCliSession>();
  const state = { down: false };

  const secret = () => `rs_${randomUUID()}`;
  const seconds = () => Math.floor(clock.now / 1000);

  function leaseOf(activation: FakeActivation, subscription: FakeSubscription): string {
    const now = seconds();
    return signLease(
      {
        v: 1,
        kid: TEST_KID,
        iss: 'licenses.manablox.io',
        aid: activation.id,
        iid: activation.instanceId,
        key: keyId(activation.key),
        products: subscription.products,
        kind: activation.kind,
        status: subscription.status,
        periodEnd: subscription.periodEnd,
        iat: now,
        nbf: now,
        exp: Math.min(now + 14 * DAY, subscription.periodEnd + 14 * DAY),
      },
      TEST_PRIVATE_KEY,
    );
  }

  /** Refuses a key that cannot get a lease now. */
  function refusal(subscription: FakeSubscription | undefined): Response | null {
    if (!subscription) return failure(404, 'key.invalid');
    if (subscription.revoked) return failure(403, 'key.revoked');
    if (subscription.status === 'canceled' && seconds() > subscription.periodEnd) {
      return failure(403, 'subscription.inactive');
    }
    return null;
  }

  function rotate(activation: FakeActivation): string {
    activation.previous = { secret: activation.secret, until: clock.now + 10 * 60_000 };
    activation.secret = secret();
    activation.lastSeenAt = clock.now;
    return activation.secret;
  }

  function activate(body: Record<string, unknown>): Response {
    const key = String(body.key ?? '');
    const subscription = keys.get(key);
    const refused = refusal(subscription);
    if (refused || !subscription) return refused as Response;
    const instanceId = String(body.instanceId ?? '');
    const kind = subscription.hosted ? 'hosted' : (body.kind as FakeActivation['kind']);
    const existing = [...activations.values()].find(
      (activation) =>
        activation.key === key && activation.instanceId === instanceId && !activation.deactivated,
    );
    if (existing) {
      existing.kind = kind;
      existing.conflictAt = null;
      const refreshSecret = rotate(existing);
      existing.previous = null;
      return json(201, {
        activationId: existing.id,
        lease: leaseOf(existing, subscription),
        refreshSecret,
        kind: existing.kind,
      });
    }
    if (kind === 'production') {
      const seats = [...activations.values()].filter(
        (activation) =>
          activation.key === key && activation.kind === 'production' && !activation.deactivated,
      );
      if (seats.length >= subscription.quantity) {
        return failure(409, 'seats.none', {
          activations: seats.map((activation) => ({
            id: activation.id,
            name: activation.name,
            hostnames: activation.hostnames,
            lastSeenAt: new Date(activation.lastSeenAt).toISOString(),
          })),
        });
      }
    }
    const activation: FakeActivation = {
      id: `act_${randomUUID()}`,
      key,
      instanceId,
      kind,
      name: typeof body.name === 'string' ? body.name : null,
      hostnames: (body.hostnames as string[]) ?? [],
      versions: (body.versions as Record<string, string>) ?? {},
      secret: secret(),
      previous: null,
      conflictAt: null,
      deactivated: false,
      lastSeenAt: clock.now,
    };
    activations.set(activation.id, activation);
    return json(201, {
      activationId: activation.id,
      lease: leaseOf(activation, subscription),
      refreshSecret: activation.secret,
      kind: activation.kind,
    });
  }

  function refresh(id: string, body: Record<string, unknown>): Response {
    const activation = activations.get(id);
    if (!activation || activation.deactivated) return failure(404, 'activation.notFound');
    const presented = String(body.refreshSecret ?? '');
    const current = presented === activation.secret;
    const previous =
      activation.previous?.secret === presented && clock.now < activation.previous.until;
    if (!current && !previous) {
      activation.conflictAt = clock.now;
      return failure(409, 'activation.conflict');
    }
    const subscription = keys.get(activation.key);
    const refused = refusal(subscription);
    if (refused || !subscription) return refused as Response;
    activation.hostnames = (body.hostnames as string[]) ?? activation.hostnames;
    const refreshSecret = current
      ? rotate(activation)
      : // A retry after a lost answer: a new secret, the previous one still valid.
        (() => {
          activation.secret = secret();
          activation.lastSeenAt = clock.now;
          return activation.secret;
        })();
    return json(200, { lease: leaseOf(activation, subscription), refreshSecret });
  }

  function deactivate(id: string, body: Record<string, unknown>): Response {
    const activation = activations.get(id);
    if (!activation || activation.deactivated) return failure(404, 'activation.notFound');
    const proven =
      body.refreshSecret === activation.secret ||
      body.refreshSecret === activation.previous?.secret ||
      body.key === activation.key;
    if (!proven) return failure(403, 'request.invalid');
    activation.deactivated = true;
    return new Response(null, { status: 204 });
  }

  function startSession(body: Record<string, unknown>): Response {
    const session: FakeCliSession = {
      id: randomUUID(),
      code: `WXYZ-${sessions.size + 2345}`,
      pollToken: `poll_${randomUUID()}`,
      products: (body.products as string[]) ?? [],
      interval: String(body.interval ?? ''),
      instanceId: typeof body.instanceId === 'string' ? body.instanceId : null,
      trial: body.trial === true,
      status: 'pending',
      key: null,
      delivered: false,
    };
    sessions.set(session.id, session);
    return json(201, {
      id: session.id,
      code: session.code,
      url: `https://licenses.test/cli/${session.code}`,
      pollToken: session.pollToken,
      interval: 3,
      expiresIn: 1800,
    });
  }

  function pollSession(id: string, authorization: string | null): Response {
    const session = sessions.get(id);
    if (!session || authorization !== `Bearer ${session.pollToken}`) {
      return failure(404, 'cliSession.notFound');
    }
    if (session.status !== 'completed') return json(200, { status: session.status });
    if (session.delivered || !session.key) return json(200, { status: 'completed' });
    session.delivered = true;
    return json(200, { status: 'completed', key: session.key });
  }

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const path = url.pathname.replace(/^\/api/, '');
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body });
    if (state.down) throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    if (method === 'POST' && path === '/v1/activations') return activate(body);
    if (method === 'GET' && path === '/v1/catalog') return json(200, FAKE_CATALOG);
    if (method === 'POST' && path === '/v1/cli-sessions') return startSession(body);
    const session = /^\/v1\/cli-sessions\/([^/]+)$/.exec(path);
    if (method === 'GET' && session?.[1]) {
      const headers = new Headers(init?.headers);
      return pollSession(decodeURIComponent(session[1]), headers.get('authorization'));
    }
    const refreshed = /^\/v1\/activations\/([^/]+)\/refresh$/.exec(path);
    if (method === 'POST' && refreshed?.[1]) return refresh(decodeURIComponent(refreshed[1]), body);
    const one = /^\/v1\/activations\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && one?.[1]) return deactivate(decodeURIComponent(one[1]), body);
    return failure(404, 'request.invalid');
  }) as typeof globalThis.fetch;

  return {
    fetch,
    keys,
    activations,
    calls,
    state,
    sessions,
    /** Completes the session as a checkout would, with a new key of its products. */
    completeSession(id: string): string {
      const session = sessions.get(id);
      if (!session) throw new Error(`no session ${id}`);
      const key = generateLicenseKey();
      keys.set(key, {
        products: session.products as PremiumProduct[],
        quantity: 1,
        status: 'trialing',
        periodEnd: seconds() + 14 * DAY,
      });
      session.status = 'completed';
      session.key = key;
      return key;
    },
    /** A new key of a subscription; production seats `quantity`, both products by default. */
    addKey(subscription: Partial<FakeSubscription> = {}): string {
      const key = generateLicenseKey();
      keys.set(key, {
        products: ['ai', 'website'],
        quantity: 1,
        status: 'active',
        periodEnd: seconds() + 30 * DAY,
        ...subscription,
      });
      return key;
    },
  };
}

export type FakeLicenseServer = ReturnType<typeof fakeLicenseServer>;
