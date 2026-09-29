import { ManabloxError } from '@manablox/core';
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { batches } from '../batch.js';
import type { SpaceGroupRow, SpaceRow } from '../schema/index.js';
import { Repository } from './base.js';

export interface SpaceGroupWriteData {
  name: string;
  externalId?: string | null | undefined;
}

/** Groups of spaces the control API limits together; a space is in at most one. */
export class SpaceGroupRepository extends Repository {
  list(): Promise<SpaceGroupRow[]> {
    const { spaceGroups } = this.t;
    return this.db.select().from(spaceGroups).orderBy(asc(spaceGroups.name), asc(spaceGroups.id));
  }

  findById(id: string): Promise<SpaceGroupRow | null> {
    return this.findOne(this.t.spaceGroups, id);
  }

  findByExternalId(externalId: string): Promise<SpaceGroupRow | null> {
    const { spaceGroups } = this.t;
    return this.findOneWhere(spaceGroups, eq(spaceGroups.externalId, externalId));
  }

  /** The group a space is in, or `null`. */
  async findBySpace(spaceId: string): Promise<SpaceGroupRow | null> {
    const { spaceGroups, spaces } = this.t;
    const [row] = await this.db
      .select({ group: spaceGroups })
      .from(spaces)
      .innerJoin(spaceGroups, eq(spaceGroups.id, spaces.groupId))
      .where(eq(spaces.id, spaceId))
      .limit(1);
    return row?.group ?? null;
  }

  async create(data: SpaceGroupWriteData): Promise<SpaceGroupRow> {
    const { spaceGroups } = this.t;
    const [row] = await this.db
      .insert(spaceGroups)
      .values({ name: data.name, externalId: data.externalId ?? null })
      .returning();
    if (!row) throw new ManabloxError('internal.error');
    return row;
  }

  async update(id: string, data: Partial<SpaceGroupWriteData>): Promise<SpaceGroupRow | null> {
    const { spaceGroups } = this.t;
    const [row] = await this.db
      .update(spaceGroups)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.externalId !== undefined ? { externalId: data.externalId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(spaceGroups.id, id))
      .returning();
    return row ?? null;
  }

  /** Deletes the group; its spaces keep existing without one. */
  delete(id: string): Promise<boolean> {
    return this.removeOne(this.t.spaceGroups, id);
  }

  /** The spaces in a group, by name. */
  listSpaces(groupId: string): Promise<SpaceRow[]> {
    const { spaces } = this.t;
    return this.db
      .select()
      .from(spaces)
      .where(eq(spaces.groupId, groupId))
      .orderBy(asc(spaces.name));
  }

  async listSpaceIds(groupId: string): Promise<string[]> {
    const { spaces } = this.t;
    const rows = await this.db
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.groupId, groupId));
    return rows.map((row) => row.id);
  }

  /**
   * Moves spaces into the group, out of any other; `replace` also takes the group's other
   * spaces out of it. Returns the ids of every space whose group changed.
   */
  async assignSpaces(
    groupId: string,
    spaceIds: readonly string[],
    options: { replace?: boolean } = {},
  ): Promise<string[]> {
    const { spaces } = this.t;
    const ids = [...new Set(spaceIds)];
    return this.db.transaction(async (tx) => {
      const changed: string[] = [];
      if (options.replace) {
        const removed = await tx
          .update(spaces)
          .set({ groupId: null })
          .where(
            and(
              eq(spaces.groupId, groupId),
              ...(ids.length > 0 ? [notInArray(spaces.id, ids)] : []),
            ),
          )
          .returning({ id: spaces.id });
        changed.push(...removed.map((row) => row.id));
      }
      for (const batch of batches(ids, 1, this.dialect.maxParameters)) {
        const moved = await tx
          .select({ id: spaces.id, groupId: spaces.groupId })
          .from(spaces)
          .where(inArray(spaces.id, batch));
        const move = moved.filter((row) => row.groupId !== groupId).map((row) => row.id);
        if (move.length === 0) continue;
        await tx.update(spaces).set({ groupId }).where(inArray(spaces.id, move));
        changed.push(...move);
      }
      return changed;
    });
  }

  /** Takes spaces out of whatever group they are in. */
  async unassignSpaces(spaceIds: readonly string[]): Promise<void> {
    const { spaces } = this.t;
    for (const batch of batches([...new Set(spaceIds)], 1, this.dialect.maxParameters)) {
      await this.db.update(spaces).set({ groupId: null }).where(inArray(spaces.id, batch));
    }
  }
}
