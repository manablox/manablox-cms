import { ManabloxError } from '@manablox/core';
import { and, count, eq, like } from 'drizzle-orm';
import type { RoleRow } from '../schema/index.js';
import { Repository } from './base.js';

export interface RoleWriteData {
  /** Lets an import keep the id its memberships reference. */
  id?: string | undefined;
  name: string;
  machineName: string;
  description?: string | null;
  permissions: string[];
}

export class RoleRepository extends Repository {
  async listBySpace(spaceId: string): Promise<RoleRow[]> {
    const { roles } = this.t;
    return this.db.select().from(roles).where(eq(roles.spaceId, spaceId)).orderBy(roles.name);
  }

  findById(id: string): Promise<RoleRow | null> {
    return this.findOne(this.t.roles, id);
  }

  findByMachineName(spaceId: string, machineName: string): Promise<RoleRow | null> {
    const { roles } = this.t;
    return this.findOneWhere(
      roles,
      and(eq(roles.spaceId, spaceId), eq(roles.machineName, machineName)),
    );
  }

  async create(spaceId: string, data: RoleWriteData): Promise<RoleRow> {
    const { roles } = this.t;
    const [row] = await this.db
      .insert(roles)
      .values({ spaceId, ...data })
      .returning();
    if (!row) throw new ManabloxError('role.create.failed');
    return row;
  }

  async update(id: string, data: Partial<RoleWriteData>): Promise<RoleRow> {
    const { roles } = this.t;
    const [row] = await this.db
      .update(roles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(roles.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('role.notFound', { id });
    return row;
  }

  delete(id: string): Promise<boolean> {
    return this.removeOne(this.t.roles, id);
  }

  /** Members of the space holding the role. */
  async countMembers(spaceId: string, machineName: string): Promise<number> {
    const { memberships } = this.t;
    const rows = await this.db
      .select({ count: count() })
      .from(memberships)
      .where(and(eq(memberships.spaceId, spaceId), eq(memberships.role, machineName)));
    return rows[0]?.count ?? 0;
  }

  /** Gives every role of the space holding a grant on type `from` the same grant on `to`. */
  async copyContentTypeGrants(spaceId: string, from: string, to: string): Promise<void> {
    const suffix = `:${from}`;
    for (const role of await this.listBySpace(spaceId)) {
      const added = role.permissions
        .filter((grant) => grant.endsWith(suffix))
        .map((grant) => `${grant.slice(0, -suffix.length)}:${to}`)
        .filter((grant) => !role.permissions.includes(grant));
      if (added.length)
        await this.update(role.id, { permissions: [...role.permissions, ...added] });
    }
  }

  /** Drops grants naming a deleted content type from every role, in one statement. */
  async pruneContentType(typeId: string): Promise<void> {
    const { roles } = this.t;
    const suffix = `:${typeId}`;
    await this.db
      .update(roles)
      .set({
        permissions: this.dialect.jsonArrayWithout(roles.permissions, `%${suffix}`),
        updatedAt: new Date(),
      })
      .where(like(this.dialect.jsonText(roles.permissions), `%${suffix}%`));
  }
}
