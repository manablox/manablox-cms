import {
  ManabloxError,
  type ResourceSource,
  type Scope,
  type SignatureAlgorithm,
  type SignatureFormat,
} from '@manablox/core';
import {
  type AgeCutoff,
  batches,
  type DatabaseContext,
  firstPage,
  inProduction,
  type Paginated,
  type Pagination,
  Repository,
  type UsageSpaces,
} from '@manablox/db';
import { and, count, desc, eq, inArray, ne } from 'drizzle-orm';
import type {
  WebhookAuthMode,
  WebhookDirection,
  WebhookMethod,
  WebhookPayload,
} from '../../sdk.js';
import {
  type WebhookDeliveryRow,
  type WebhookRow,
  type WebhookTables,
  webhookTables,
} from './rows.js';

export interface WebhookWriteData {
  id?: string | undefined;
  spaceId: string;
  /** The space's production environment when absent. */
  environmentId?: string | null | undefined;
  direction?: WebhookDirection | undefined;
  name: string;
  slug?: string | undefined;
  source?: ResourceSource | undefined;
  sourceRef?: string | null | undefined;
  description?: string | null | undefined;
  url?: string | undefined;
  events?: string[] | undefined;
  headers?: Array<{ name: string; value: string }> | undefined;
  methods?: WebhookMethod[] | undefined;
  authMode?: WebhookAuthMode | undefined;
  credentialId?: string | null | undefined;
  signatureHeader?: string | undefined;
  algorithm?: SignatureAlgorithm | undefined;
  signatureFormat?: SignatureFormat | undefined;
  enabled?: boolean | undefined;
}

export interface WebhookDeliveryData {
  webhookId: string;
  spaceId?: string | null | undefined;
  direction?: WebhookDirection | undefined;
  event: string;
  payload: Record<string, unknown> | WebhookPayload;
  headers?: Record<string, string> | undefined;
  status: number | null;
  error: string | null;
  attempt?: number | undefined;
  ms?: number | null | undefined;
  runIds?: string[] | undefined;
}

/** A space's webhooks and their delivery log. */
export class WebhookRepository extends Repository<WebhookTables> {
  /** `changeListeners` is shared with the repository's transactional copies. */
  constructor(
    context: DatabaseContext,
    private readonly changeListeners = new Set<(spaceId: string) => void>(),
  ) {
    super(context, webhookTables(context));
  }

  /** Called, after commit, with the space whose endpoints were written. */
  onChange(listener: (spaceId: string) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private changed(spaceIds: Iterable<string | undefined>): void {
    const spaces = new Set([...spaceIds].filter((id): id is string => Boolean(id)));
    if (spaces.size === 0) return;
    this.afterCommit(() => {
      for (const spaceId of spaces) for (const listener of this.changeListeners) listener(spaceId);
    });
  }

  findById(id: string): Promise<WebhookRow | null> {
    return this.findOne(this.t.webhooks, id);
  }

  /** Ignores `enabled`; the route decides. */
  findIncomingBySlug(scope: Scope, slug: string): Promise<WebhookRow | null> {
    const { webhooks } = this.t;
    return this.findOneWhere(
      webhooks,
      and(
        this.inEnvironment(webhooks, scope),
        eq(webhooks.direction, 'incoming'),
        eq(webhooks.slug, slug),
      ),
    );
  }

  /** Endpoints of the scope that did not come from code. */
  countRuntimeBySpace(scope: Scope): Promise<number> {
    const { webhooks } = this.t;
    return this.db.$count(
      webhooks,
      and(this.inEnvironment(webhooks, scope), ne(webhooks.source, 'code')),
    );
  }

  async listBySpace(scope: Scope, direction?: WebhookDirection): Promise<WebhookRow[]> {
    const { webhooks } = this.t;
    return this.db
      .select()
      .from(webhooks)
      .where(
        and(
          this.inEnvironment(webhooks, scope),
          direction ? eq(webhooks.direction, direction) : undefined,
        ),
      )
      .orderBy(webhooks.direction, webhooks.name);
  }

  /** A page of a space's webhooks, by direction then name. */
  pageBySpace(
    scope: Scope,
    direction: WebhookDirection | undefined,
    pagination: Pagination,
  ): Promise<Paginated<WebhookRow>> {
    const { webhooks } = this.t;
    return this.paginate(
      webhooks,
      and(
        this.inEnvironment(webhooks, scope),
        direction ? eq(webhooks.direction, direction) : undefined,
      ),
      [webhooks.direction, webhooks.name, webhooks.id],
      pagination,
    );
  }

  /** `listBySpace` for many spaces, keyed by space id; `all` takes every environment. */
  listBySpaces(
    spaceIds: readonly string[],
    direction?: WebhookDirection,
    environments: 'production' | 'all' = 'production',
  ): Promise<Map<string, WebhookRow[]>> {
    const { webhooks } = this.t;
    return this.bySpaces(spaceIds, (batch) =>
      this.db
        .select()
        .from(webhooks)
        .where(
          and(
            inArray(webhooks.spaceId, batch),
            direction ? eq(webhooks.direction, direction) : undefined,
            environments === 'all' ? undefined : inProduction(this.core, webhooks),
          ),
        )
        .orderBy(webhooks.direction, webhooks.name),
    );
  }

  async create(data: WebhookWriteData): Promise<WebhookRow> {
    const { webhooks } = this.t;
    const [row] = await this.db
      .insert(webhooks)
      .values({
        ...(data.id ? { id: data.id } : {}),
        spaceId: data.spaceId,
        environmentId: this.environmentOf(data),
        direction: data.direction ?? 'outgoing',
        name: data.name,
        slug: data.slug ?? '',
        source: data.source ?? 'runtime',
        sourceRef: data.sourceRef ?? null,
        description: data.description ?? null,
        url: data.url ?? '',
        events: data.events ?? [],
        headers: data.headers ?? [],
        methods: data.methods ?? [],
        authMode: data.authMode ?? 'none',
        credentialId: data.credentialId ?? null,
        ...(data.signatureHeader ? { signatureHeader: data.signatureHeader } : {}),
        ...(data.algorithm ? { algorithm: data.algorithm } : {}),
        ...(data.signatureFormat ? { signatureFormat: data.signatureFormat } : {}),
        enabled: data.enabled ?? true,
      })
      .returning();
    if (!row) throw new ManabloxError('plugins.webhooks.create.failed');
    this.changed([row.spaceId]);
    return row;
  }

  async update(id: string, data: Partial<WebhookWriteData>): Promise<WebhookRow> {
    const { webhooks } = this.t;
    const { id: _id, spaceId: _spaceId, environmentId: _environmentId, ...rest } = data;
    const [row] = await this.db
      .update(webhooks)
      .set({ ...rest, updatedAt: new Date() })
      .where(eq(webhooks.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('plugins.webhooks.notFound', { id });
    this.changed([row.spaceId]);
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const { webhooks } = this.t;
    const [row] = await this.db
      .delete(webhooks)
      .where(eq(webhooks.id, id))
      .returning({ spaceId: webhooks.spaceId });
    this.changed([row?.spaceId]);
    return row !== undefined;
  }

  /** Enabled outgoing webhooks of an environment. */
  async listEnabledBySpace(scope: Scope): Promise<WebhookRow[]> {
    const { webhooks } = this.t;
    return this.db
      .select()
      .from(webhooks)
      .where(
        and(
          this.inEnvironment(webhooks, scope),
          eq(webhooks.direction, 'outgoing'),
          eq(webhooks.enabled, true),
        ),
      );
  }

  /** Sets `lastUsedAt`. */
  async touch(id: string, at: Date): Promise<void> {
    const { webhooks } = this.t;
    await this.db.update(webhooks).set({ lastUsedAt: at }).where(eq(webhooks.id, id));
  }

  /** Endpoints of production in the spaces; every space's for `all`. */
  async countProduction(spaceIds: UsageSpaces): Promise<number> {
    if (spaceIds !== 'all' && spaceIds.length === 0) return 0;
    const { webhooks } = this.t;
    const [row] = await this.db
      .select({ value: count() })
      .from(webhooks)
      .where(
        and(
          spaceIds === 'all' ? undefined : inArray(webhooks.spaceId, [...spaceIds]),
          inProduction(this.core, webhooks),
        ),
      );
    return row?.value ?? 0;
  }

  /** Every endpoint of an environment, for copies and promotes. */
  listByEnvironment(environmentId: string): Promise<WebhookRow[]> {
    const { webhooks } = this.t;
    return this.db.select().from(webhooks).where(eq(webhooks.environmentId, environmentId));
  }

  /** Inserts rows as given, e.g. an environment's copies. */
  async insertRows(rows: readonly WebhookTables['webhooks']['$inferInsert'][]): Promise<void> {
    if (rows.length === 0) return;
    const columns = Object.keys(rows[0] ?? {}).length;
    for (const batch of batches(rows, columns, this.dialect.maxParameters)) {
      await this.db.insert(this.t.webhooks).values([...batch]);
    }
    this.changed(rows.map((row) => row.spaceId));
  }

  async createDelivery(data: WebhookDeliveryData): Promise<WebhookDeliveryRow> {
    const { webhookDeliveries } = this.t;
    const [row] = await this.db
      .insert(webhookDeliveries)
      .values({
        webhookId: data.webhookId,
        spaceId: data.spaceId ?? null,
        direction: data.direction ?? 'outgoing',
        event: data.event,
        payload: data.payload,
        headers: data.headers ?? {},
        status: data.status,
        error: data.error,
        attempt: data.attempt ?? 1,
        ms: data.ms ?? null,
        runIds: data.runIds ?? [],
      })
      .returning();
    return row as WebhookDeliveryRow;
  }

  findDeliveryById(id: string): Promise<WebhookDeliveryRow | null> {
    return this.findOne(this.t.webhookDeliveries, id);
  }

  /** A page of the calls over an endpoint, newest first. */
  pageDeliveries(
    webhookId: string,
    pagination: Pagination = firstPage(),
  ): Promise<Paginated<WebhookDeliveryRow>> {
    const { webhookDeliveries } = this.t;
    return this.paginate(
      webhookDeliveries,
      eq(webhookDeliveries.webhookId, webhookId),
      [desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id)],
      pagination,
    );
  }

  /** Keeps only the newest `keep` deliveries of an endpoint. */
  keepDeliveries(webhookId: string, keep: number): Promise<void> {
    const { webhookDeliveries } = this.t;
    return this.keepNewest(webhookDeliveries, {
      partition: webhookDeliveries.webhookId,
      keep,
      scope: eq(webhookDeliveries.webhookId, webhookId),
    });
  }

  /** Deletes a batch of the space's deliveries, every endpoint's, older than the cutoff. */
  pruneDeliveries(age: AgeCutoff): Promise<number> {
    return this.pruneAged(this.t.webhookDeliveries, age);
  }
}
