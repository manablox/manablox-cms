import { ManabloxError, type Scope, scopeOf, scopeSpaceId } from '@manablox/core';
import { configuredSafeFetch, type Manablox } from '@manablox/core/node';
import type { Paginated, Pagination, Repositories } from '@manablox/db';
import { hookScope, requireInSpace } from '@manablox/services';
import type { WebhookDeliveryView, WebhookDirection, WebhookView } from '../../sdk.js';
import { receiptAuditor, webhookAuditor } from '../audit.js';
import { type WebhookRow, webhookRepos } from '../db/index.js';
import { webhookKeys } from '../keys.js';
import { enabledEndpoints, type WebhookContext } from './webhook/context.js';
import { receive } from './webhook/incoming.js';
import { deliver, dispatch, send } from './webhook/outgoing.js';
import type {
  IncomingCall,
  IncomingResult,
  WebhookDelivery,
  WebhookInput,
  WebhookServiceOptions,
} from './webhook/types.js';
import { validateWebhookInput } from './webhook/validate.js';
import { deliveryView, webhookView } from './webhook/views.js';

export type {
  IncomingCall,
  IncomingResult,
  IncomingWebhookListener,
  WebhookDelivery,
  WebhookInput,
  WebhookServiceOptions,
} from './webhook/types.js';

/** Code endpoints are read-only, except for the enabled switch. */
function assertNotCode(row: WebhookRow): void {
  if (row.source === 'code') {
    throw ManabloxError.forbidden('plugins.webhooks.code.immutable', {
      name: row.name,
      sourceRef: row.sourceRef,
    });
  }
}

/**
 * Outgoing webhooks fire from content hooks via the job queue; incoming calls are verified,
 * logged, handed to the `webhooks:received` hook and to the listener, such as the workflows
 * they start. Secrets live only in the vault.
 */
export class WebhookService {
  private readonly audit;
  private readonly ctx: WebhookContext;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    private readonly options: WebhookServiceOptions,
  ) {
    this.audit = webhookAuditor(repos);
    this.ctx = {
      manablox,
      repos,
      store: webhookRepos(repos),
      options,
      fetch: options.fetch ?? configuredSafeFetch(manablox.config.net),
      now: options.now ?? (() => new Date()),
      receipts: receiptAuditor(repos),
      listener: options.listener ?? null,
      enabled: enabledEndpoints(manablox, repos),
    };
  }

  /** This service on other repositories, e.g. a transaction's. */
  using(repos: Repositories): WebhookService {
    return new WebhookService(this.manablox, repos, {
      ...this.options,
      credentials: this.options.credentials?.using(repos),
      fetch: this.ctx.fetch,
      now: this.ctx.now,
    });
  }

  /** A page of a space's webhooks, by direction then name. */
  async list(
    scope: Scope,
    direction: WebhookDirection | undefined,
    pagination: Pagination,
  ): Promise<Paginated<WebhookView>> {
    const page = await this.ctx.store.pageBySpace(scope, direction, pagination);
    const counts = await this.listenerCounts(scope, page.items);
    return {
      ...page,
      items: await Promise.all(page.items.map((row) => this.view(row, counts.get(row.id) ?? 0))),
    };
  }

  /**
   * Rows already loaded, with the listeners each has, as `list` returns them; `environment` is
   * a staging environment's machine name.
   */
  views(
    rows: WebhookRow[],
    listeners: ReadonlyMap<string, number>,
    environment: string | null = null,
  ): WebhookView[] {
    return rows.map((row) =>
      webhookView(this.manablox, row, listeners.get(row.id) ?? 0, environment),
    );
  }

  async get(scope: Scope, id: string): Promise<WebhookView> {
    const row = await this.find(scope, id);
    const counts = await this.listenerCounts(scope, [row]);
    return this.view(row, counts.get(row.id) ?? 0);
  }

  /** `id` and `via` are set by imports, which need no `webhooks`: their endpoints come disabled. */
  async create(
    scope: Scope,
    input: WebhookInput,
    options: { id?: string | undefined; via?: string | undefined } = {},
  ): Promise<WebhookView> {
    const spaceId = scopeSpaceId(scope);
    if (!options.via) await this.assertOn(scope);
    const valid = await validateWebhookInput(this.repos, scope, input, null);
    await this.manablox.hooks.run(
      'webhooks:beforeCreate',
      { spaceId, direction: valid.direction, name: valid.name },
      { manablox: this.manablox, ...hookScope(scope) },
    );
    await this.manablox.controls.assertLimit(scope, webhookKeys.limits.count);
    const row = await this.repos.transaction(async (tx) => {
      const row = await webhookRepos(tx).create({
        id: options.id,
        spaceId,
        ...(typeof scope === 'string' ? {} : { environmentId: scope.environmentId }),
        ...valid,
      });
      await this.audit
        .in(tx)
        .record(
          'webhooks.webhook.create',
          row,
          undefined,
          options.via ? { via: options.via } : null,
        );
      return row;
    });
    return this.view(row, 0);
  }

  async update(scope: Scope, id: string, input: WebhookInput): Promise<WebhookView> {
    await this.assertOn(scope);
    const before = await this.find(scope, id);
    assertNotCode(before);
    if (before.direction !== input.direction) {
      throw ManabloxError.badRequest('plugins.webhooks.direction.mismatch', {
        from: before.direction,
        to: input.direction,
      });
    }
    const valid = await validateWebhookInput(this.repos, scope, input, id);
    const row = await this.repos.transaction(async (tx) => {
      const row = await webhookRepos(tx).update(id, valid);
      await this.audit.in(tx).record('webhooks.webhook.update', row);
      return row;
    });
    const counts = await this.listenerCounts(scope, [row]);
    return this.view(row, counts.get(row.id) ?? 0);
  }

  /** Allowed on code endpoints too. */
  async setEnabled(scope: Scope, id: string, enabled: boolean): Promise<WebhookView> {
    await this.assertOn(scope);
    await this.find(scope, id);
    const row = await this.repos.transaction(async (tx) => {
      const row = await webhookRepos(tx).update(id, { enabled });
      await this.audit.in(tx).record('webhooks.webhook.setEnabled', row, undefined, { enabled });
      return row;
    });
    const counts = await this.listenerCounts(scope, [row]);
    return this.view(row, counts.get(row.id) ?? 0);
  }

  async delete(scope: Scope, id: string): Promise<void> {
    await this.assertOn(scope);
    const row = await this.find(scope, id);
    assertNotCode(row);
    await this.repos.transaction(async (tx) => {
      await webhookRepos(tx).delete(id);
      await this.audit.in(tx).record('webhooks.webhook.delete', row);
    });
  }

  /** A page of an endpoint's calls, newest first. */
  async deliveries(
    scope: Scope,
    id: string,
    pagination?: Pagination,
  ): Promise<Paginated<WebhookDeliveryView>> {
    await this.find(scope, id);
    const page = await this.ctx.store.pageDeliveries(id, pagination);
    return { ...page, items: page.items.map((row) => deliveryView(row)) };
  }

  /** Resends an outgoing delivery as a new attempt. Incoming calls cannot be replayed. */
  async retry(scope: Scope, id: string, deliveryId: string): Promise<WebhookDeliveryView> {
    await this.assertOn(scope);
    const webhook = await this.find(scope, id);
    const delivery = await this.ctx.store.findDeliveryById(deliveryId);
    if (!delivery || delivery.webhookId !== id) {
      throw ManabloxError.notFound('plugins.webhooks.delivery.notFound', { id: deliveryId });
    }
    if (webhook.direction !== 'outgoing') {
      throw ManabloxError.badRequest('plugins.webhooks.delivery.notRetryable');
    }
    const row = await send(this.ctx, webhook, {
      webhookId: id,
      event: delivery.event,
      payload: delivery.payload as Record<string, unknown>,
      attempt: delivery.attempt + 1,
    });
    return deliveryView(row);
  }

  /** Sends a test delivery. */
  async test(scope: Scope, id: string): Promise<WebhookDeliveryView> {
    await this.assertOn(scope);
    const webhook = await this.find(scope, id);
    if (webhook.direction !== 'outgoing')
      throw ManabloxError.badRequest('plugins.webhooks.delivery.notRetryable');
    const row = await send(this.ctx, webhook, {
      webhookId: id,
      event: 'webhook.test',
      payload: { test: true, at: this.ctx.now().toISOString() },
    });
    await this.audit.record('webhooks.webhook.test', webhook, undefined, {
      status: row.status,
      error: row.error,
    });
    return deliveryView(row);
  }

  /** Queues a delivery per payload, per event the one satisfies, per enabled webhook listening. */
  dispatch(
    event: string,
    scope: Scope,
    payloads: readonly Record<string, unknown>[],
  ): Promise<void> {
    return dispatch(this.ctx, event, scope, payloads);
  }

  /** Sends and logs one delivery; throws on failure so the queue's backoff retries. */
  deliver(data: WebhookDelivery): Promise<void> {
    return deliver(this.ctx, data);
  }

  /**
   * Verifies, logs (rejections too) and hands an incoming call to the hook and the listener.
   * Throws on a bad signature, disabled endpoint or disallowed method.
   */
  receive(scope: Scope, slug: string, call: IncomingCall): Promise<IncomingResult> {
    return receive(this.ctx, scope, slug, call);
  }

  /** Webhook writes need the plugin on; reads stay open. */
  private assertOn(scope: Scope): Promise<void> {
    return this.manablox.controls.assertFeature(scopeSpaceId(scope), webhookKeys.feature);
  }

  private async view(row: WebhookRow, listeners: number): Promise<WebhookView> {
    const scope = await this.repos.environments.resolve(scopeOf(row));
    const staging = scope && !scope.production ? scope.machineName : null;
    return webhookView(this.manablox, row, listeners, staging);
  }

  /** Listeners per incoming endpoint, for the list. */
  private async listenerCounts(scope: Scope, rows: WebhookRow[]): Promise<Map<string, number>> {
    const listener = this.ctx.listener;
    if (!listener || !rows.some((row) => row.direction === 'incoming')) return new Map();
    return listener.counts(scope);
  }

  private find(scope: Scope, id: string): Promise<WebhookRow> {
    return this.ctx.store
      .findById(id)
      .then((row) => requireInSpace(row, scope, 'plugins.webhooks.notFound', { id }));
  }
}
