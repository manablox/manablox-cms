import {
  type ContentTypeDefinition,
  type ContentTypeInput,
  defineContentType,
  fnv1a,
  ManabloxError,
  type Scope,
} from '@manablox/core';
import { eq, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { ContentTypeRow } from '../schema/index.js';
import { inProduction, Repository } from './base.js';

/**
 * Runtime-defined content types; code-defined ones come from the config. A space's types
 * belong to one of its environments; global ones (no space) to none.
 */
export class ContentTypeRepository extends Repository {
  /** Global types and every environment's; staging ones carry their environment. */
  async listAll(): Promise<ContentTypeDefinition[]> {
    const { contentTypes } = this.t;
    const rows = await this.db
      .select({ row: contentTypes, staging: this.isStaging() })
      .from(contentTypes);
    return rows.map(({ row, staging }) => toDefinition(row, Boolean(staging)));
  }

  /** One space's types in every environment; the global types for `null`. */
  async listOfSpace(spaceId: string | null): Promise<ContentTypeDefinition[]> {
    const { contentTypes } = this.t;
    const rows = await this.db
      .select({ row: contentTypes, staging: this.isStaging() })
      .from(contentTypes)
      .where(spaceId === null ? isNull(contentTypes.spaceId) : eq(contentTypes.spaceId, spaceId));
    return rows.map(({ row, staging }) => toDefinition(row, Boolean(staging)));
  }

  /** Global types and the production types of every space. */
  async list(): Promise<ContentTypeDefinition[]> {
    const { contentTypes } = this.t;
    const rows = await this.db.select().from(contentTypes).where(this.globalOrProduction());
    return rows.map((row) => toDefinition(row, false));
  }

  /** A space's types in one environment. */
  async listByScope(scope: Scope): Promise<ContentTypeDefinition[]> {
    const { contentTypes } = this.t;
    const rows = await this.db
      .select({ row: contentTypes, staging: this.isStaging() })
      .from(contentTypes)
      .where(this.inEnvironment(contentTypes, scope));
    return rows.map(({ row, staging }) => toDefinition(row, Boolean(staging)));
  }

  /** Changes whenever a type `listAll()` returns is created, edited or deleted; cheaper than it. */
  async fingerprint(): Promise<string> {
    const { contentTypes } = this.t;
    const rows = await this.db
      .select({ id: contentTypes.id, updatedAt: contentTypes.updatedAt })
      .from(contentTypes);
    const entries = rows.map((row) => `${row.id}:${row.updatedAt.getTime()}`).sort();
    return `${entries.length}:${fnv1a(entries.join(','))}`;
  }

  async findById(id: string): Promise<ContentTypeDefinition | null> {
    const { contentTypes } = this.t;
    const [found] = await this.db
      .select({ row: contentTypes, staging: this.isStaging() })
      .from(contentTypes)
      .where(eq(contentTypes.id, id))
      .limit(1);
    return found ? toDefinition(found.row, Boolean(found.staging)) : null;
  }

  /**
   * A space's type goes into `environmentId`, or the space's production environment; a
   * staging type's input names its environment, which then also derives its default id.
   */
  async create(
    input: ContentTypeInput,
    environmentId: string | null = input.environmentId ?? null,
  ): Promise<ContentTypeDefinition> {
    const { contentTypes } = this.t;
    // Same normalisation as code-defined types.
    const definition = defineContentType(input);
    const spaceId = definition.spaceId;

    const [row] = await this.db
      .insert(contentTypes)
      .values({
        id: definition.id,
        spaceId,
        environmentId: spaceId ? this.environmentOf({ spaceId, environmentId }) : null,
        name: definition.name,
        label: definition.label,
        description: definition.description ?? null,
        icon: definition.icon ?? null,
        kind: definition.kind,
        hasSlug: definition.hasSlug,
        isPublishable: definition.isPublishable,
        isVisibleInTree: definition.isVisibleInTree,
        canBeVisibleInMenu: definition.canBeVisibleInMenu,
        requiresApproval: definition.requiresApproval,
        fields: definition.fields,
      })
      .returning();

    if (!row) throw new ManabloxError('contentType.create.failed');
    return toDefinition(row, Boolean(definition.environmentId));
  }

  async update(id: string, input: ContentTypeInput): Promise<ContentTypeDefinition> {
    const { contentTypes } = this.t;
    const existing = await this.findById(id);
    if (!existing) throw ManabloxError.notFound('contentType.notFound', { id });

    // The kind is fixed at creation; the flags are normalised against the stored one.
    const definition = defineContentType({
      ...input,
      id,
      kind: existing.kind,
      environmentId: existing.environmentId ?? null,
    });

    // Field names are public GraphQL API; a rename must be remove + add.
    for (const field of definition.fields) {
      const previous = existing.fields.find((candidate) => candidate.id === field.id);
      if (previous && previous.name !== field.name) {
        throw ManabloxError.badRequest('contentType.field.name.immutable', {
          from: previous.name,
          to: field.name,
        });
      }
    }

    const [row] = await this.db
      .update(contentTypes)
      .set({
        name: definition.name,
        label: definition.label,
        description: definition.description ?? null,
        icon: definition.icon ?? null,
        hasSlug: definition.hasSlug,
        isPublishable: definition.isPublishable,
        isVisibleInTree: definition.isVisibleInTree,
        canBeVisibleInMenu: definition.canBeVisibleInMenu,
        requiresApproval: definition.requiresApproval,
        fields: definition.fields,
        updatedAt: new Date(),
      })
      .where(eq(contentTypes.id, id))
      .returning();

    if (!row) throw ManabloxError.notFound('contentType.notFound', { id });
    return toDefinition(row, Boolean(existing.environmentId));
  }

  delete(id: string): Promise<boolean> {
    return this.removeOne(this.t.contentTypes, id);
  }

  /** Whether the row is in a staging environment. */
  private isStaging(): SQL<number> {
    const { contentTypes, spaceEnvironments: e } = this.t;
    return sql<number>`(case when exists (select 1 from ${e} where ${e.id} = ${contentTypes.environmentId} and ${e.kind} <> 'production') then 1 else 0 end)`.mapWith(
      Number,
    );
  }

  private globalOrProduction(): SQL | undefined {
    const { contentTypes } = this.t;
    return or(isNull(contentTypes.spaceId), inProduction(this.t, contentTypes));
  }
}

function toDefinition(row: ContentTypeRow, staging: boolean): ContentTypeDefinition {
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.icon !== null ? { icon: row.icon } : {}),
    kind: row.kind,
    spaceId: row.spaceId,
    ...(staging && row.environmentId ? { environmentId: row.environmentId } : {}),
    hasSlug: row.hasSlug,
    isPublishable: row.isPublishable,
    isVisibleInTree: row.isVisibleInTree,
    canBeVisibleInMenu: row.canBeVisibleInMenu,
    requiresApproval: row.requiresApproval,
    // System types are code-defined.
    isSystem: false,
    fields: row.fields,
    source: 'runtime',
  };
}
