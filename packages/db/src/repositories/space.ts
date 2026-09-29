import {
  type Loose,
  ManabloxError,
  type SpaceImportProgress,
  type SpaceImportStatus,
} from '@manablox/core';
import { and, count, eq, inArray, lt, or } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { SpaceRow } from '../schema/index.js';
import { inProduction, Repository } from './base.js';
import { insertProduction } from './environment.js';

export interface SpaceWriteData {
  id?: string | undefined;
  name: string;
  machineName: string;
  description?: string | null | undefined;
  url: string;
  defaultLocale?: string | undefined;
  locales?: string[] | undefined;
  settings?: Record<string, unknown> | undefined;
}

/** Rows a space holds, by kind. */
export interface SpaceCounts {
  documents: number;
  contentTypes: number;
  members: number;
  assets: number;
}

export class SpaceRepository extends Repository {
  async list(): Promise<SpaceRow[]> {
    const { spaces } = this.t;
    return this.db.select().from(spaces).orderBy(spaces.name);
  }

  async listByIds(ids: string[]): Promise<SpaceRow[]> {
    const { spaces } = this.t;
    if (ids.length === 0) return [];
    return this.db.select().from(spaces).where(inArray(spaces.id, ids)).orderBy(spaces.name);
  }

  findById(id: string): Promise<SpaceRow | null> {
    return this.findOne(this.t.spaces, id);
  }

  /** The row, locked until the surrounding transaction ends; `null` when there is none. */
  async lockById(id: string): Promise<SpaceRow | null> {
    const { spaces } = this.t;
    const rows = await this.dialect.forUpdate(
      this.db.select().from(spaces).where(eq(spaces.id, id)).limit(1),
    );
    return rows[0] ?? null;
  }

  findByMachineName(machineName: string): Promise<SpaceRow | null> {
    const { spaces } = this.t;
    return this.findOneWhere(spaces, eq(spaces.machineName, machineName));
  }

  /** `importing` creates the space hidden until its import finishes. Adds its production environment. */
  async create(
    data: SpaceWriteData,
    importing?: { status: SpaceImportStatus; progress: SpaceImportProgress },
  ): Promise<SpaceRow> {
    const { spaces } = this.t;
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(spaces)
        .values({
          ...(data.id ? { id: data.id } : {}),
          name: data.name,
          machineName: data.machineName,
          description: data.description ?? null,
          url: data.url,
          defaultLocale: data.defaultLocale ?? 'en',
          locales: data.locales ?? [data.defaultLocale ?? 'en'],
          settings: data.settings ?? {},
          ...(importing
            ? { importStatus: importing.status, importProgress: importing.progress }
            : {}),
        })
        .returning();
      if (!row) throw new ManabloxError('space.create.failed');
      await insertProduction(tx, this.t, row.id);
      return row;
    });
  }

  async update(id: string, data: Loose<SpaceWriteData>): Promise<SpaceRow> {
    const { spaces } = this.t;
    const [row] = await this.db
      .update(spaces)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.machineName !== undefined ? { machineName: data.machineName } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.url !== undefined ? { url: data.url } : {}),
        ...(data.defaultLocale !== undefined ? { defaultLocale: data.defaultLocale } : {}),
        ...(data.locales !== undefined ? { locales: data.locales } : {}),
        ...(data.settings !== undefined ? { settings: data.settings } : {}),
        updatedAt: new Date(),
      })
      .where(eq(spaces.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('space.notFound', { id });
    return row;
  }

  /** Records import progress; `null` status marks the space ready. */
  async setImport(
    id: string,
    status: SpaceImportStatus | null,
    progress: SpaceImportProgress | null,
  ): Promise<SpaceRow> {
    const { spaces } = this.t;
    const [row] = await this.db
      .update(spaces)
      .set({ importStatus: status, importProgress: progress, updatedAt: new Date() })
      .where(eq(spaces.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('space.notFound', { id });
    return row;
  }

  /** Moves a failed import, or one idle since `staleBefore`, back to importing; `null` when neither. */
  async claimImport(id: string, staleBefore: Date): Promise<SpaceRow | null> {
    const { spaces } = this.t;
    const [row] = await this.db
      .update(spaces)
      .set({ importStatus: 'importing', updatedAt: new Date() })
      .where(
        and(
          eq(spaces.id, id),
          or(
            eq(spaces.importStatus, 'failed'),
            and(eq(spaces.importStatus, 'importing'), lt(spaces.updatedAt, staleBefore)),
          ),
        ),
      )
      .returning();
    return row ?? null;
  }

  delete(id: string): Promise<boolean> {
    return this.removeOne(this.t.spaces, id);
  }

  /**
   * Counts per space id; all spaces when `ids` is absent. Documents count every locale of
   * the production environment.
   */
  async counts(ids?: readonly string[]): Promise<Map<string, SpaceCounts>> {
    const { contents, contentTypes, memberships, assetSpaces } = this.t;
    const out = new Map<string, SpaceCounts>();
    if (ids?.length === 0) return out;
    const tally = async (
      field: keyof SpaceCounts,
      rows: Promise<Array<{ spaceId: string | null; n: number }>>,
    ) => {
      for (const { spaceId, n } of await rows) {
        if (!spaceId) continue;
        const entry = out.get(spaceId) ?? { documents: 0, contentTypes: 0, members: 0, assets: 0 };
        entry[field] = Number(n);
        out.set(spaceId, entry);
      }
    };
    const within = (column: PgColumn) => (ids ? inArray(column, [...ids]) : undefined);
    await tally(
      'documents',
      this.db
        .select({ spaceId: contents.spaceId, n: count() })
        .from(contents)
        .where(and(within(contents.spaceId), inProduction(this.t, contents)))
        .groupBy(contents.spaceId),
    );
    await tally(
      'contentTypes',
      this.db
        .select({ spaceId: contentTypes.spaceId, n: count() })
        .from(contentTypes)
        .where(and(within(contentTypes.spaceId), inProduction(this.t, contentTypes)))
        .groupBy(contentTypes.spaceId),
    );
    await tally(
      'members',
      this.db
        .select({ spaceId: memberships.spaceId, n: count() })
        .from(memberships)
        .where(within(memberships.spaceId))
        .groupBy(memberships.spaceId),
    );
    await tally(
      'assets',
      this.db
        .select({ spaceId: assetSpaces.spaceId, n: count() })
        .from(assetSpaces)
        .where(within(assetSpaces.spaceId))
        .groupBy(assetSpaces.spaceId),
    );
    return out;
  }
}
