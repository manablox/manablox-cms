import { type Scope, scopeSpaceId } from '@manablox/core';
import {
  checkOrder,
  type DatabaseContext,
  type HostVerificationData,
  inProduction,
  pendingVerification,
  Repository,
  type UsageSpaces,
} from '@manablox/db';
import { and, asc, count, eq, inArray, isNotNull, isNull, ne, type SQL } from 'drizzle-orm';
import type { SiteDomainRow } from '../rows.js';
import { type WebsiteTables, websiteTables } from '../rows.js';

export interface SiteDomainWriteData extends Partial<HostVerificationData> {
  hostname: string;
  locale: string | null;
  isPrimary: boolean;
  redirectToPrimary: boolean;
}

/** Host names of designed sites. */
export class SiteDomainRepository extends Repository<WebsiteTables> {
  constructor(context: DatabaseContext) {
    super(context, websiteTables(context));
  }

  listBySpace(scope: Scope): Promise<SiteDomainRow[]> {
    const { websiteDomains } = this.t;
    return this.db
      .select()
      .from(websiteDomains)
      .where(this.inEnvironment(websiteDomains, scope))
      .orderBy(asc(websiteDomains.hostname));
  }

  findById(id: string, scope: Scope): Promise<SiteDomainRow | null> {
    const { websiteDomains } = this.t;
    return this.findOneWhere(
      websiteDomains,
      and(eq(websiteDomains.id, id), this.inEnvironment(websiteDomains, scope)),
    );
  }

  /** Across every space; `hostname` is normalised already. */
  findByHostname(hostname: string): Promise<SiteDomainRow | null> {
    const { websiteDomains } = this.t;
    return this.findOneWhere(websiteDomains, eq(websiteDomains.hostname, hostname));
  }

  /** Every host name of every space and environment. */
  async hostnames(): Promise<string[]> {
    const { websiteDomains } = this.t;
    const rows = await this.db
      .select({ hostname: websiteDomains.hostname })
      .from(websiteDomains)
      .orderBy(asc(websiteDomains.hostname));
    return rows.map((row) => row.hostname);
  }

  /** Hosts waiting for a DNS check, least recently checked first. */
  listPendingVerification(limit: number): Promise<SiteDomainRow[]> {
    const { websiteDomains } = this.t;
    return this.db
      .select()
      .from(websiteDomains)
      .where(pendingVerification(websiteDomains))
      .orderBy(checkOrder(websiteDomains))
      .limit(limit);
  }

  async setVerification(
    id: string,
    data: Partial<HostVerificationData>,
  ): Promise<SiteDomainRow | null> {
    const { websiteDomains } = this.t;
    const [row] = await this.db
      .update(websiteDomains)
      .set(data)
      .where(eq(websiteDomains.id, id))
      .returning();
    return row ?? null;
  }

  /** The canonical host of a space and locale (`null`: the locale-less one). */
  findPrimary(scope: Scope, locale: string | null): Promise<SiteDomainRow | null> {
    const { websiteDomains } = this.t;
    return this.findOneWhere(
      websiteDomains,
      and(
        this.inEnvironment(websiteDomains, scope),
        eq(websiteDomains.isPrimary, true),
        this.sameLocale(locale),
      ),
    );
  }

  async create(scope: Scope, data: SiteDomainWriteData): Promise<SiteDomainRow> {
    const { websiteDomains } = this.t;
    const [row] = await this.db
      .insert(websiteDomains)
      .values({
        spaceId: scopeSpaceId(scope),
        environmentId: this.environmentOf(scope),
        ...data,
      })
      .returning();
    return row as SiteDomainRow;
  }

  async update(
    id: string,
    scope: Scope,
    data: Partial<SiteDomainWriteData>,
  ): Promise<SiteDomainRow | null> {
    const { websiteDomains } = this.t;
    const [row] = await this.db
      .update(websiteDomains)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(websiteDomains.id, id), this.inEnvironment(websiteDomains, scope)))
      .returning();
    return row ?? null;
  }

  /** Takes the primary flag from the space's other hosts of `locale`. */
  async clearPrimary(scope: Scope, locale: string | null, exceptId: string): Promise<void> {
    const { websiteDomains } = this.t;
    await this.db
      .update(websiteDomains)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          this.inEnvironment(websiteDomains, scope),
          eq(websiteDomains.isPrimary, true),
          ne(websiteDomains.id, exceptId),
          this.sameLocale(locale),
        ),
      );
  }

  /** Hands every host of one environment to another; returns how many moved. */
  async moveSpace(from: Scope, to: Scope): Promise<number> {
    const { websiteDomains } = this.t;
    const rows = await this.db
      .update(websiteDomains)
      .set({
        spaceId: scopeSpaceId(to),
        environmentId: this.environmentOf(to),
        updatedAt: new Date(),
      })
      .where(this.inEnvironment(websiteDomains, from))
      .returning({ id: websiteDomains.id });
    return rows.length;
  }

  /** Production hosts of the spaces, every space's for `all`. */
  async countInProduction(spaceIds: UsageSpaces): Promise<number> {
    const { websiteDomains } = this.t;
    if (spaceIds !== 'all' && spaceIds.length === 0) return 0;
    const [row] = await this.db
      .select({ value: count() })
      .from(websiteDomains)
      .where(
        and(
          spaceIds === 'all'
            ? isNotNull(websiteDomains.spaceId)
            : inArray(websiteDomains.spaceId, [...spaceIds]),
          inProduction(this.core, websiteDomains),
        ),
      );
    return row?.value ?? 0;
  }

  delete(id: string, scope: Scope): Promise<boolean> {
    const { websiteDomains } = this.t;
    return this.removeWhere(
      websiteDomains,
      and(eq(websiteDomains.id, id), this.inEnvironment(websiteDomains, scope)),
    );
  }

  private sameLocale(locale: string | null): SQL {
    const { websiteDomains } = this.t;
    return locale === null ? isNull(websiteDomains.locale) : eq(websiteDomains.locale, locale);
  }
}
