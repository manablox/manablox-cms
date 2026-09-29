import { type Scope, scopeSpaceId } from '@manablox/core';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { SpaceApiHostRow } from '../schema/index.js';
import { inProduction, Repository } from './base.js';
import { checkOrder, type HostVerificationData, pendingVerification } from './host-verification.js';

export interface SpaceApiHostWriteData extends Partial<HostVerificationData> {
  hostname: string;
}

/** Host names the public API resolves a space from. */
export class SpaceApiHostRepository extends Repository {
  listBySpace(scope: Scope): Promise<SpaceApiHostRow[]> {
    const { spaceApiHosts } = this.t;
    return this.db
      .select()
      .from(spaceApiHosts)
      .where(this.inEnvironment(spaceApiHosts, scope))
      .orderBy(asc(spaceApiHosts.hostname));
  }

  /** Production hosts grouped by space; every id gets an entry. */
  listBySpaces(spaceIds: readonly string[]): Promise<Map<string, SpaceApiHostRow[]>> {
    const { spaceApiHosts } = this.t;
    return this.bySpaces(spaceIds, (batch) =>
      this.db
        .select()
        .from(spaceApiHosts)
        .where(and(inArray(spaceApiHosts.spaceId, batch), inProduction(this.t, spaceApiHosts)))
        .orderBy(asc(spaceApiHosts.hostname)),
    );
  }

  findById(id: string, scope: Scope): Promise<SpaceApiHostRow | null> {
    const { spaceApiHosts } = this.t;
    return this.findOneWhere(
      spaceApiHosts,
      and(eq(spaceApiHosts.id, id), this.inEnvironment(spaceApiHosts, scope)),
    );
  }

  /** Across every space; `hostname` is normalised already. */
  findByHostname(hostname: string): Promise<SpaceApiHostRow | null> {
    const { spaceApiHosts } = this.t;
    return this.findOneWhere(spaceApiHosts, eq(spaceApiHosts.hostname, hostname));
  }

  /** Every host name of every space and environment. */
  async hostnames(): Promise<string[]> {
    const { spaceApiHosts } = this.t;
    const rows = await this.db
      .select({ hostname: spaceApiHosts.hostname })
      .from(spaceApiHosts)
      .orderBy(asc(spaceApiHosts.hostname));
    return rows.map((row) => row.hostname);
  }

  /** Whether the instance has any API host at all. */
  async any(): Promise<boolean> {
    const { spaceApiHosts } = this.t;
    const [row] = await this.db.select({ n: count() }).from(spaceApiHosts).limit(1);
    return Number(row?.n ?? 0) > 0;
  }

  async create(scope: Scope, data: SpaceApiHostWriteData): Promise<SpaceApiHostRow> {
    const { spaceApiHosts } = this.t;
    const [row] = await this.db
      .insert(spaceApiHosts)
      .values({
        spaceId: scopeSpaceId(scope),
        environmentId: this.environmentOf(scope),
        ...data,
      })
      .returning();
    return row as SpaceApiHostRow;
  }

  /** Hosts waiting for a DNS check, least recently checked first. */
  listPendingVerification(limit: number): Promise<SpaceApiHostRow[]> {
    const { spaceApiHosts } = this.t;
    return this.db
      .select()
      .from(spaceApiHosts)
      .where(pendingVerification(spaceApiHosts))
      .orderBy(checkOrder(spaceApiHosts))
      .limit(limit);
  }

  async setVerification(
    id: string,
    data: Partial<HostVerificationData>,
  ): Promise<SpaceApiHostRow | null> {
    const { spaceApiHosts } = this.t;
    const [row] = await this.db
      .update(spaceApiHosts)
      .set(data)
      .where(eq(spaceApiHosts.id, id))
      .returning();
    return row ?? null;
  }

  /** Hands every host of one environment to another; returns how many moved. */
  async moveSpace(from: Scope, to: Scope): Promise<number> {
    const { spaceApiHosts } = this.t;
    const rows = await this.db
      .update(spaceApiHosts)
      .set({ spaceId: scopeSpaceId(to), environmentId: this.environmentOf(to) })
      .where(this.inEnvironment(spaceApiHosts, from))
      .returning({ id: spaceApiHosts.id });
    return rows.length;
  }

  delete(id: string, scope: Scope): Promise<boolean> {
    const { spaceApiHosts } = this.t;
    return this.removeWhere(
      spaceApiHosts,
      and(eq(spaceApiHosts.id, id), this.inEnvironment(spaceApiHosts, scope)),
    );
  }
}
