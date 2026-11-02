import type { ResourceSource, Scope } from '@manablox/core';
import { batches, type DatabaseContext, Repository } from '@manablox/db';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { SiteDesignKindName } from '../../../shared/site.js';
import type { SiteDesignRow, SiteDesignVersionRow } from '../rows.js';
import { type WebsiteTables, websiteTables } from '../rows.js';

export interface SiteDesignCreateData {
  spaceId: string;
  /** The space's production environment when absent. */
  environmentId?: string | null | undefined;
  kind: SiteDesignKindName;
  key: string;
  name?: string | undefined;
  draft: unknown;
  actorId?: string | null | undefined;
}

/** A version without its data, for the history list. */
export type SiteDesignVersionSummary = Omit<SiteDesignVersionRow, 'data'>;

/** Stored designs of designed sites and their version snapshots. */
export class SiteDesignRepository extends Repository<WebsiteTables> {
  constructor(context: DatabaseContext) {
    super(context, websiteTables(context));
  }

  /** An environment's stored designs, by kind and key; `kind` narrows them. */
  listBySpace(scope: Scope, kind?: SiteDesignKindName): Promise<SiteDesignRow[]> {
    const { websiteDesigns } = this.t;
    return this.db
      .select()
      .from(websiteDesigns)
      .where(
        and(
          this.inEnvironment(websiteDesigns, scope),
          kind ? eq(websiteDesigns.kind, kind) : undefined,
        ),
      )
      .orderBy(asc(websiteDesigns.kind), asc(websiteDesigns.key));
  }

  findById(id: string, scope: Scope): Promise<SiteDesignRow | null> {
    const { websiteDesigns } = this.t;
    return this.findOneWhere(
      websiteDesigns,
      and(eq(websiteDesigns.id, id), this.inEnvironment(websiteDesigns, scope)),
    );
  }

  find(scope: Scope, kind: SiteDesignKindName, key: string): Promise<SiteDesignRow | null> {
    const { websiteDesigns } = this.t;
    return this.findOneWhere(
      websiteDesigns,
      and(
        this.inEnvironment(websiteDesigns, scope),
        eq(websiteDesigns.kind, kind),
        eq(websiteDesigns.key, key),
      ),
    );
  }

  /** Designs whose draft differs from the live copy, or that were never published. */
  listDirty(scope: Scope): Promise<SiteDesignRow[]> {
    const { websiteDesigns } = this.t;
    return this.db
      .select()
      .from(websiteDesigns)
      .where(
        and(
          this.inEnvironment(websiteDesigns, scope),
          or(
            isNull(websiteDesigns.publishedVersion),
            ne(websiteDesigns.publishedVersion, websiteDesigns.version),
          ),
        ),
      )
      .orderBy(asc(websiteDesigns.kind), asc(websiteDesigns.key));
  }

  async create(data: SiteDesignCreateData): Promise<SiteDesignRow> {
    const { websiteDesigns } = this.t;
    const [row] = await this.db
      .insert(websiteDesigns)
      .values({
        spaceId: data.spaceId,
        environmentId: this.environmentOf(data),
        kind: data.kind,
        key: data.key,
        name: data.name ?? '',
        draft: data.draft,
        createdBy: data.actorId ?? null,
        updatedBy: data.actorId ?? null,
      })
      .returning();
    return row as SiteDesignRow;
  }

  /** Writes a design as a transfer carries it: draft, live copy and their versions. */
  async restore(
    data: SiteDesignCreateData & {
      published: unknown;
      version: number;
      publishedVersion: number | null;
      publishedAt: Date | null;
      source?: ResourceSource | undefined;
      sourceRef?: string | null | undefined;
    },
  ): Promise<SiteDesignRow> {
    const { websiteDesigns } = this.t;
    const [row] = await this.db
      .insert(websiteDesigns)
      .values({
        spaceId: data.spaceId,
        environmentId: this.environmentOf(data),
        kind: data.kind,
        key: data.key,
        name: data.name ?? '',
        draft: data.draft,
        published: data.published,
        version: data.version,
        publishedVersion: data.publishedVersion,
        publishedAt: data.publishedAt,
        publishedBy: data.publishedAt ? (data.actorId ?? null) : null,
        source: data.source ?? 'runtime',
        sourceRef: data.sourceRef ?? null,
        createdBy: data.actorId ?? null,
        updatedBy: data.actorId ?? null,
      })
      .returning();
    return row as SiteDesignRow;
  }

  /** Replaces the draft when the stored version is `expectedVersion`; `null` on a mismatch. */
  async saveDraft(
    id: string,
    expectedVersion: number,
    data: { draft: unknown; name?: string | undefined; actorId?: string | null | undefined },
  ): Promise<SiteDesignRow | null> {
    const { websiteDesigns } = this.t;
    const [row] = await this.db
      .update(websiteDesigns)
      .set({
        draft: data.draft,
        ...(data.name !== undefined ? { name: data.name } : {}),
        version: sql`${websiteDesigns.version} + 1`,
        updatedBy: data.actorId ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(websiteDesigns.id, id), eq(websiteDesigns.version, expectedVersion)))
      .returning();
    return row ?? null;
  }

  /** Copies the draft into the live copy. */
  async publish(id: string, actorId: string | null, at: Date = new Date()): Promise<SiteDesignRow> {
    const { websiteDesigns } = this.t;
    const [row] = await this.db
      .update(websiteDesigns)
      .set({
        published: sql`${websiteDesigns.draft}`,
        publishedVersion: sql`${websiteDesigns.version}`,
        publishedAt: at,
        publishedBy: actorId,
      })
      .where(eq(websiteDesigns.id, id))
      .returning();
    return row as SiteDesignRow;
  }

  /** Sets the draft back to the live copy; the design is clean afterwards. */
  async discardDraft(id: string, actorId: string | null): Promise<SiteDesignRow> {
    const { websiteDesigns } = this.t;
    const [row] = await this.db
      .update(websiteDesigns)
      .set({
        draft: sql`${websiteDesigns.published}`,
        version: sql`${websiteDesigns.version} + 1`,
        publishedVersion: sql`${websiteDesigns.version} + 1`,
        updatedBy: actorId,
        updatedAt: new Date(),
      })
      .where(eq(websiteDesigns.id, id))
      .returning();
    return row as SiteDesignRow;
  }

  delete(id: string, scope: Scope): Promise<boolean> {
    const { websiteDesigns } = this.t;
    return this.removeWhere(
      websiteDesigns,
      and(eq(websiteDesigns.id, id), this.inEnvironment(websiteDesigns, scope)),
    );
  }

  // --- versions ------------------------------------------------------------------

  async addVersion(data: {
    designId: string;
    spaceId: string;
    version: number;
    data: unknown;
    label?: string | null | undefined;
    actorId?: string | null | undefined;
  }): Promise<SiteDesignVersionRow> {
    const { websiteDesignVersions } = this.t;
    const [row] = await this.db
      .insert(websiteDesignVersions)
      .values({
        designId: data.designId,
        spaceId: data.spaceId,
        version: data.version,
        data: data.data,
        label: data.label ?? null,
        createdBy: data.actorId ?? null,
      })
      .returning();
    return row as SiteDesignVersionRow;
  }

  /** A design's snapshots, newest first, without their data. */
  listVersions(designId: string): Promise<SiteDesignVersionSummary[]> {
    const { websiteDesignVersions: v } = this.t;
    return this.db
      .select({
        id: v.id,
        designId: v.designId,
        spaceId: v.spaceId,
        version: v.version,
        label: v.label,
        createdAt: v.createdAt,
        createdBy: v.createdBy,
      })
      .from(v)
      .where(eq(v.designId, designId))
      .orderBy(desc(v.createdAt), desc(v.version));
  }

  /** Keeps the newest `keep` snapshots of each design, of one design with `designId`. */
  async pruneVersions(spaceId: string, keep: number, designId?: string): Promise<void> {
    const { websiteDesignVersions: v } = this.t;
    await this.keepNewest(v, {
      partition: v.designId,
      keep,
      scope: and(
        eq(v.spaceId, spaceId),
        designId === undefined ? undefined : eq(v.designId, designId),
      ),
    });
  }

  findVersion(designId: string, versionId: string): Promise<SiteDesignVersionRow | null> {
    const { websiteDesignVersions: v } = this.t;
    return this.findOneWhere(v, and(eq(v.designId, designId), eq(v.id, versionId)));
  }

  // --- Raw environment rows, for copies and promotes ---------------------------

  /** Every design of the environment, as stored. */
  listByEnvironment(environmentId: string): Promise<SiteDesignRow[]> {
    const { websiteDesigns } = this.t;
    return this.db
      .select()
      .from(websiteDesigns)
      .where(eq(websiteDesigns.environmentId, environmentId));
  }

  /** Writes rows as given, ids included. */
  async insertRows(rows: readonly SiteDesignRow[]): Promise<void> {
    for (const batch of batches(rows, 20, this.dialect.maxParameters)) {
      await this.db.insert(this.t.websiteDesigns).values(batch);
    }
  }

  /** Sets columns of one row. */
  async updateRow(id: string, patch: Partial<Omit<SiteDesignRow, 'id'>>): Promise<void> {
    const { websiteDesigns } = this.t;
    await this.db.update(websiteDesigns).set(patch).where(eq(websiteDesigns.id, id));
  }

  /** Deletes rows by id. */
  async removeRows(ids: readonly string[]): Promise<void> {
    const { websiteDesigns } = this.t;
    for (const batch of batches(ids, 1, this.dialect.maxParameters)) {
      await this.db.delete(websiteDesigns).where(inArray(websiteDesigns.id, batch));
    }
  }
}
