import {
  type AuditActor,
  type Loose,
  ManabloxError,
  type ResourceSource,
  type Scope,
} from '@manablox/core';
import {
  batches,
  type DatabaseContext,
  firstPage,
  inProduction,
  type Paginated,
  type Pagination,
  paginate,
  Repository,
  type UsageSpaces,
} from '@manablox/db';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { WorkflowAbortTrigger } from '../../sdk/abort.js';
import type {
  WorkflowEdge,
  WorkflowNode,
  WorkflowSnapshot,
  WorkflowTrigger,
} from '../../sdk/workflow.js';
import {
  type WorkflowRow,
  type WorkflowTables,
  type WorkflowVersionRow,
  workflowTables,
} from './rows.js';

export interface WorkflowWriteData {
  id?: string | undefined;
  spaceId: string;
  /** The space's production environment when absent. */
  environmentId?: string | null | undefined;
  name: string;
  /** Empty for admin-made workflows. */
  slug?: string | undefined;
  source?: ResourceSource | undefined;
  sourceRef?: string | null | undefined;
  description?: string | null | undefined;
  enabled?: boolean | undefined;
  trigger: WorkflowTrigger;
  abortTriggers?: WorkflowAbortTrigger[] | undefined;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  draftChanged?: boolean | undefined;
}

/** The row with a version's definition in place of the draft. */
export function withVersion(row: WorkflowRow, version: WorkflowVersionRow): WorkflowRow {
  return {
    ...row,
    name: version.name,
    description: version.description,
    trigger: version.trigger,
    abortTriggers: version.abortTriggers,
    nodes: version.nodes,
    edges: version.edges,
  };
}

export interface WorkflowPublishData {
  definition: WorkflowSnapshot;
  note?: string | null | undefined;
  publishedBy?: AuditActor | null | undefined;
}

/** A trigger kind as stored, whether or not its plugin is configured. */
export type StoredTriggerKind = WorkflowTrigger['kind'] | (string & Record<never, never>);

/** What dispatch needs of a live workflow: its published triggers, without the graph. */
export interface LiveWorkflow {
  id: string;
  spaceId: string;
  environmentId: string;
  /** As published. */
  name: string;
  enabled: boolean;
  publishedVersion: number;
  trigger: WorkflowTrigger;
  abortTriggers: WorkflowAbortTrigger[];
}

export interface LiveWorkflowFilter {
  /** Every space when absent. */
  spaceId?: string | undefined;
  /** Production when absent. */
  environmentId?: string | undefined;
  /** `all` takes every environment's, `environmentId` aside. */
  environments?: 'production' | 'all' | undefined;
  kinds?: readonly StoredTriggerKind[] | undefined;
}

/** A published version without its graph. */
export type WorkflowVersionSummaryRow = Pick<
  WorkflowVersionRow,
  'version' | 'name' | 'note' | 'publishedBy' | 'createdAt'
> & { nodeCount: number };

/** Workflows, their published versions and live-trigger notifications. */
export class WorkflowRepository extends Repository<WorkflowTables> {
  /** `liveListeners` is shared with the repository's transactional copies. */
  constructor(
    context: DatabaseContext,
    readonly liveListeners = new Set<(spaceId: string) => void>(),
  ) {
    super(context, workflowTables(context));
  }

  // --- workflows -------------------------------------------------------------

  /** Enabled production workflows of the spaces; every space's for `all`. */
  async countActive(spaceIds: UsageSpaces): Promise<number> {
    if (spaceIds !== 'all' && spaceIds.length === 0) return 0;
    const { workflows } = this.t;
    const [row] = await this.db
      .select({ value: count() })
      .from(workflows)
      .where(
        and(
          eq(workflows.enabled, true),
          spaceIds === 'all' ? undefined : inArray(workflows.spaceId, [...spaceIds]),
          inProduction(this.core, workflows),
        ),
      );
    return row?.value ?? 0;
  }

  /** Workflows of the scope that did not come from code. */
  countRuntimeBySpace(scope: Scope): Promise<number> {
    const { workflows } = this.t;
    return this.db.$count(
      workflows,
      and(this.inEnvironment(workflows, scope), ne(workflows.source, 'code')),
    );
  }

  listBySpace(scope: Scope): Promise<WorkflowRow[]> {
    const { workflows } = this.t;
    return this.db
      .select()
      .from(workflows)
      .where(this.inEnvironment(workflows, scope))
      .orderBy(workflows.name);
  }

  /** A page of a space's workflows by name. */
  pageBySpace(scope: Scope, pagination: Pagination = firstPage()): Promise<Paginated<WorkflowRow>> {
    const { workflows } = this.t;
    return this.paginate(
      workflows,
      this.inEnvironment(workflows, scope),
      [workflows.name, workflows.id],
      pagination,
    );
  }

  /** Every space's workflows by name, keyed by space id; `all` takes every environment. */
  listBySpaces(
    spaceIds: readonly string[],
    environments: 'production' | 'all' = 'production',
  ): Promise<Map<string, WorkflowRow[]>> {
    const { workflows } = this.t;
    return this.bySpaces(spaceIds, (batch) =>
      this.db
        .select()
        .from(workflows)
        .where(
          and(
            inArray(workflows.spaceId, batch),
            environments === 'all' ? undefined : inProduction(this.core, workflows),
          ),
        )
        .orderBy(workflows.name),
    );
  }

  /** Enabled, published workflows' triggers as published, without graphs; production unless filtered. */
  async listLive(filter: LiveWorkflowFilter = {}): Promise<LiveWorkflow[]> {
    const { workflows, workflowVersions } = this.t;
    const { spaces } = this.core;
    const rows = await this.db
      .select({
        id: workflows.id,
        spaceId: workflows.spaceId,
        environmentId: workflows.environmentId,
        name: workflowVersions.name,
        enabled: workflows.enabled,
        publishedVersion: workflows.publishedVersion,
        trigger: workflowVersions.trigger,
        abortTriggers: workflowVersions.abortTriggers,
      })
      .from(workflows)
      .innerJoin(
        workflowVersions,
        and(
          eq(workflowVersions.workflowId, workflows.id),
          eq(workflowVersions.version, workflows.publishedVersion),
        ),
      )
      // A space still importing runs nothing.
      .innerJoin(spaces, eq(spaces.id, workflows.spaceId))
      .where(
        and(
          eq(workflows.enabled, true),
          isNull(spaces.importStatus),
          filter.spaceId ? eq(workflows.spaceId, filter.spaceId) : undefined,
          filter.environmentId
            ? eq(workflows.environmentId, filter.environmentId)
            : filter.environments === 'all'
              ? undefined
              : inProduction(this.core, workflows),
          filter.kinds ? inArray(workflows.triggerKind, [...filter.kinds]) : undefined,
        ),
      );
    return rows as LiveWorkflow[];
  }

  /** Called with the space whose live workflows may have changed. */
  onLiveChange(listener: (spaceId: string) => void): () => void {
    this.liveListeners.add(listener);
    return () => this.liveListeners.delete(listener);
  }

  /** Tells live-change listeners after commit that the space's live workflows changed. */
  liveChanged(spaceId: string | undefined): void {
    if (!spaceId) return;
    this.afterCommit(() => {
      for (const listener of this.liveListeners) listener(spaceId);
    });
  }

  /** The workflow as published, enabled or not; null when never published. */
  async findLive(id: string): Promise<WorkflowRow | null> {
    const [row] = await this.published(eq(this.t.workflows.id, id));
    return row ?? null;
  }

  private async published(where: SQL | undefined): Promise<WorkflowRow[]> {
    const { workflows, workflowVersions } = this.t;
    const rows = await this.db
      .select({ workflow: workflows, version: workflowVersions })
      .from(workflows)
      .innerJoin(
        workflowVersions,
        and(
          eq(workflowVersions.workflowId, workflows.id),
          eq(workflowVersions.version, workflows.publishedVersion),
        ),
      )
      .where(and(isNotNull(workflows.publishedVersion), where));
    return rows.map(({ workflow, version }) => withVersion(workflow, version));
  }

  findById(id: string): Promise<WorkflowRow | null> {
    return this.findOne(this.t.workflows, id);
  }

  async create(data: WorkflowWriteData): Promise<WorkflowRow> {
    const { workflows } = this.t;
    const [row] = await this.db
      .insert(workflows)
      .values({
        ...(data.id ? { id: data.id } : {}),
        spaceId: data.spaceId,
        environmentId: this.environmentOf(data),
        name: data.name,
        slug: data.slug ?? '',
        source: data.source ?? 'runtime',
        sourceRef: data.sourceRef ?? null,
        description: data.description ?? null,
        enabled: data.enabled ?? false,
        trigger: data.trigger,
        abortTriggers: data.abortTriggers ?? [],
        nodes: data.nodes,
        edges: data.edges,
      })
      .returning();
    if (!row) throw new ManabloxError('plugins.workflows.create.failed');
    return row;
  }

  async update(
    id: string,
    data: Loose<Omit<WorkflowWriteData, 'spaceId' | 'environmentId'>>,
  ): Promise<WorkflowRow> {
    const { workflows } = this.t;
    const [row] = await this.db
      .update(workflows)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.slug !== undefined ? { slug: data.slug } : {}),
        ...(data.source !== undefined ? { source: data.source } : {}),
        ...(data.sourceRef !== undefined ? { sourceRef: data.sourceRef } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.trigger !== undefined ? { trigger: data.trigger } : {}),
        ...(data.abortTriggers !== undefined ? { abortTriggers: data.abortTriggers } : {}),
        ...(data.nodes !== undefined ? { nodes: data.nodes } : {}),
        ...(data.edges !== undefined ? { edges: data.edges } : {}),
        ...(data.draftChanged !== undefined ? { draftChanged: data.draftChanged } : {}),
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('plugins.workflows.notFound', { id });
    if (data.enabled !== undefined) this.liveChanged(row.spaceId);
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const { workflows } = this.t;
    const [row] = await this.db
      .delete(workflows)
      .where(eq(workflows.id, id))
      .returning({ spaceId: workflows.spaceId });
    this.liveChanged(row?.spaceId);
    return row !== undefined;
  }

  // --- versions --------------------------------------------------------------

  /** Freezes a definition as the next version and makes it the published one. */
  async publish(id: string, data: WorkflowPublishData): Promise<WorkflowVersionRow> {
    const { workflows, workflowVersions } = this.t;
    const { definition } = data;
    const published = await this.db.transaction(async (tx) => {
      // The increment locks the row, so concurrent publishes number in turn.
      const [bumped] = await tx
        .update(workflows)
        .set({
          publishedVersion: sql`coalesce(${workflows.publishedVersion}, 0) + 1`,
          publishedAt: new Date(),
          triggerKind: definition.trigger.kind,
          draftChanged: false,
        })
        .where(eq(workflows.id, id))
        .returning({ version: workflows.publishedVersion, spaceId: workflows.spaceId });
      if (!bumped?.version) throw ManabloxError.notFound('plugins.workflows.notFound', { id });
      const [row] = await tx
        .insert(workflowVersions)
        .values({
          workflowId: id,
          version: bumped.version,
          name: definition.name,
          description: definition.description,
          trigger: definition.trigger,
          abortTriggers: definition.abortTriggers,
          nodes: definition.nodes,
          edges: definition.edges,
          note: data.note ?? null,
          publishedBy: data.publishedBy ?? null,
        })
        .returning();
      if (!row) throw new ManabloxError('plugins.workflows.create.failed');
      return { row, spaceId: bumped.spaceId };
    });
    this.liveChanged(published.spaceId);
    return published.row;
  }

  /** A page of versions without their graphs, newest first. */
  pageVersions(
    workflowId: string,
    pagination: Pagination = firstPage(),
  ): Promise<Paginated<WorkflowVersionSummaryRow>> {
    const { workflowVersions } = this.t;
    return paginate<WorkflowVersionSummaryRow>(this.db, workflowVersions, {
      columns: {
        version: workflowVersions.version,
        name: workflowVersions.name,
        note: workflowVersions.note,
        publishedBy: workflowVersions.publishedBy,
        createdAt: workflowVersions.createdAt,
        nodeCount: sql<number>`${this.dialect.jsonArrayLength(workflowVersions.nodes)}`.mapWith(
          Number,
        ),
      },
      where: eq(workflowVersions.workflowId, workflowId),
      orderBy: desc(workflowVersions.version),
      pagination,
    });
  }

  findVersion(workflowId: string, version: number): Promise<WorkflowVersionRow | null> {
    const { workflowVersions } = this.t;
    return this.findOneWhere(
      workflowVersions,
      and(eq(workflowVersions.workflowId, workflowId), eq(workflowVersions.version, version)),
    );
  }

  /** Claims a scheduled workflow for one minute; false if already claimed. */
  async claimSchedule(id: string, minute: Date): Promise<boolean> {
    const { workflows } = this.t;
    const rows = await this.db
      .update(workflows)
      .set({ lastScheduledAt: minute })
      .where(
        and(
          eq(workflows.id, id),
          or(isNull(workflows.lastScheduledAt), lt(workflows.lastScheduledAt, minute)),
        ),
      )
      .returning({ id: workflows.id });
    return rows.length > 0;
  }

  async touchRun(id: string, at: Date): Promise<void> {
    const { workflows } = this.t;
    await this.db.update(workflows).set({ lastRunAt: at }).where(eq(workflows.id, id));
  }

  // --- summaries -------------------------------------------------------------

  /** A space's workflows by name, without their graphs. */
  listSummariesBySpace(scope: Scope): Promise<WorkflowSummary[]> {
    const { workflows } = this.t;
    return this.db
      .select({
        id: workflows.id,
        name: workflows.name,
        slug: workflows.slug,
        enabled: workflows.enabled,
        trigger: workflows.trigger,
        abortTriggers: workflows.abortTriggers,
      })
      .from(workflows)
      .where(this.inEnvironment(workflows, scope))
      .orderBy(workflows.name);
  }

  // --- environment rows ------------------------------------------------------

  /** Every workflow of the environment, drafts as stored. */
  listByEnvironment(environmentId: string): Promise<WorkflowRow[]> {
    const { workflows } = this.t;
    return this.db.select().from(workflows).where(eq(workflows.environmentId, environmentId));
  }

  /** Every version of the workflows. */
  async listVersionsOf(workflowIds: readonly string[]): Promise<WorkflowVersionRow[]> {
    const { workflowVersions } = this.t;
    const out: WorkflowVersionRow[] = [];
    for (const batch of batches([...new Set(workflowIds)], 1, this.dialect.maxParameters)) {
      out.push(
        ...(await this.db
          .select()
          .from(workflowVersions)
          .where(inArray(workflowVersions.workflowId, batch))),
      );
    }
    return out;
  }

  /** Inserts a workflow as given, e.g. an environment's copy. */
  async insertRow(row: WorkflowTables['workflows']['$inferInsert']): Promise<void> {
    await this.db.insert(this.t.workflows).values(row);
  }

  /** Inserts versions as given. */
  async insertVersionRows(
    rows: readonly WorkflowTables['workflowVersions']['$inferInsert'][],
  ): Promise<void> {
    for (const batch of batches(rows, 13, this.dialect.maxParameters)) {
      await this.db.insert(this.t.workflowVersions).values(batch);
    }
  }

  /** Sets columns of one workflow as given. */
  async updateRow(id: string, patch: Partial<Omit<WorkflowRow, 'id'>>): Promise<void> {
    const { workflows } = this.t;
    if (Object.keys(patch).length === 0) return;
    await this.db.update(workflows).set(patch).where(eq(workflows.id, id));
  }

  /** Deletes workflows by id, their versions and runs with them. */
  async removeRows(ids: readonly string[]): Promise<void> {
    const { workflows } = this.t;
    for (const batch of batches([...new Set(ids)], 1, this.dialect.maxParameters)) {
      await this.db.delete(workflows).where(inArray(workflows.id, batch));
    }
  }
}

/** A workflow's identity and triggers, for lookups that skip the graph. */
export type WorkflowSummary = Pick<
  WorkflowRow,
  'id' | 'name' | 'slug' | 'enabled' | 'trigger' | 'abortTriggers'
>;
