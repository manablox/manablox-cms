import { keyId } from '@manablox/license';
import { z } from 'zod';
import type { LicenseKind } from '../../../sdk.js';
import { type LicenseErrorKey, licenseError } from '../../errors.js';

/** A call to the license server gives up after this. */
const TIMEOUT_MS = 15_000;

/** What the instance tells the license server about itself on every call. */
export interface InstanceFacts {
  hostnames: string[];
  versions: Record<string, string>;
}

export interface ActivationRequest extends InstanceFacts {
  key: string;
  instanceId: string;
  kind: LicenseKind;
  name?: string;
}

const activated = z.object({
  activationId: z.string().min(1),
  lease: z.string().min(1),
  refreshSecret: z.string().min(1),
  kind: z.enum(['production', 'development', 'hosted']),
});
export type Activated = z.infer<typeof activated>;

const refreshed = z.object({ lease: z.string().min(1), refreshSecret: z.string().min(1) });
export type Refreshed = z.infer<typeof refreshed>;

const interval = z.enum(['month', 'year']);

const catalog = z.object({
  products: z.array(z.object({ id: z.string(), label: z.string() })),
  plans: z.array(
    z.object({
      id: z.string(),
      grants: z.array(z.string()),
      interval,
      trialDays: z.number(),
      price: z
        .object({ amount: z.string(), currency: z.string(), formatted: z.string() })
        .nullable(),
    }),
  ),
});
/** `GET /v1/catalog`: the products and the plans that sell them, with Paddle's prices. */
export type Catalog = z.infer<typeof catalog>;

/** How often a plan bills. */
export type BillingInterval = z.infer<typeof interval>;

const cliSession = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  url: z.string().url(),
  pollToken: z.string().min(1),
  interval: z.number().positive(),
  expiresIn: z.number().positive(),
});
/** A started `manablox license buy`: the code both sides show, where to confirm it, how to poll. */
export type CliSession = z.infer<typeof cliSession>;

const cliSessionState = z.union([
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('expired') }),
  z.object({ status: z.literal('completed'), key: z.string().optional() }),
]);
/** A poll's answer; `key` only comes with the first completed one. */
export type CliSessionState = z.infer<typeof cliSessionState>;

const failure = z.object({
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

/** The server's error codes and the keys they are answered with here. */
const CODES: Record<string, LicenseErrorKey> = {
  'key.invalid': 'plugins.license.key.invalid',
  'key.revoked': 'plugins.license.key.revoked',
  'key.bound': 'plugins.license.key.bound',
  'seats.none': 'plugins.license.key.noSeats',
  'trial.used': 'plugins.license.key.trialUsed',
  'activation.conflict': 'plugins.license.activation.conflict',
  'activation.notFound': 'plugins.license.activation.notFound',
  'activation.kindMismatch': 'plugins.license.activation.kindMismatch',
  'subscription.inactive': 'plugins.license.subscription.inactive',
  rateLimited: 'plugins.license.rateLimited',
  'request.invalid': 'plugins.license.request.invalid',
  'cliSession.notFound': 'plugins.license.cliSession.notFound',
};

/**
 * The license server's instance API (`/v1/activations`, `/v1/catalog`) and the terminal side of
 * `manablox license buy` (`/v1/cli-sessions`).
 */
export class LicenseClient {
  constructor(
    private readonly options: { server: string; fetch: typeof fetch; timeoutMs?: number },
  ) {}

  /** `POST /v1/activations`: a new activation, or the instance's existing one with a new secret. */
  async activate(request: ActivationRequest): Promise<Activated> {
    const body = await this.call('POST', '/v1/activations', request, { keyId: keyId(request.key) });
    return this.parse(activated, body);
  }

  /** `POST /v1/activations/:id/refresh`: a new lease and the next refresh secret. */
  async refresh(
    activationId: string,
    request: InstanceFacts & { refreshSecret: string },
  ): Promise<Refreshed> {
    const body = await this.call(
      'POST',
      `/v1/activations/${encodeURIComponent(activationId)}/refresh`,
      request,
    );
    return this.parse(refreshed, body);
  }

  /** `DELETE /v1/activations/:id`, proven by the refresh secret or by the key itself. */
  async deactivate(
    activationId: string,
    proof: { refreshSecret: string } | { key: string },
  ): Promise<void> {
    await this.call('DELETE', `/v1/activations/${encodeURIComponent(activationId)}`, proof);
  }

  /** `GET /v1/catalog`. */
  async catalog(): Promise<Catalog> {
    return this.parse(catalog, await this.call('GET', '/v1/catalog'));
  }

  /** `POST /v1/cli-sessions`: a session the portal completes once the purchase is done. */
  async startCliSession(request: {
    products: readonly string[];
    interval: BillingInterval;
    instanceId?: string;
    /** The buyer asked for a trial; the portal leads with it, checkout decides. */
    trial?: boolean;
  }): Promise<CliSession> {
    return this.parse(cliSession, await this.call('POST', '/v1/cli-sessions', request));
  }

  /** `GET /v1/cli-sessions/:id` with the poll token. */
  async pollCliSession(session: Pick<CliSession, 'id' | 'pollToken'>): Promise<CliSessionState> {
    const body = await this.call(
      'GET',
      `/v1/cli-sessions/${encodeURIComponent(session.id)}`,
      undefined,
      {},
      session.pollToken,
    );
    return this.parse(cliSessionState, body);
  }

  private async call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    payload?: unknown,
    params: Record<string, unknown> = {},
    token?: string,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.options.fetch(`${this.options.server}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? TIMEOUT_MS),
      });
    } catch (error) {
      throw licenseError('plugins.license.network', { reason: reasonOf(error) });
    }
    if (response.status === 204) return null;
    const body = await response.json().catch(() => undefined);
    if (response.ok) return body;
    const parsed = failure.safeParse(body);
    const code = parsed.success ? parsed.data.error.code : undefined;
    const key = code ? CODES[code] : undefined;
    if (!key) throw licenseError('plugins.license.server.failed', { status: response.status });
    const details = parsed.success ? (parsed.data.error.details ?? {}) : {};
    throw licenseError(key, { ...params, ...details });
  }

  private parse<T>(schema: z.ZodType<T>, body: unknown): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw licenseError('plugins.license.server.failed', { status: 200 });
    return parsed.data;
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return 'no answer in time';
  const cause =
    error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  if (typeof cause?.code === 'string') return cause.code;
  return error instanceof Error ? error.message : String(error);
}
