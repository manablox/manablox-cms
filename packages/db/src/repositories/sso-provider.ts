import { and, asc, eq, ne } from 'drizzle-orm';
import type { InvitationGrant } from '../definitions/auth.js';
import type { SsoProviderRow } from '../schema/index.js';
import { Repository } from './base.js';

export interface SsoProviderWriteData {
  providerId: string;
  name: string;
  issuer: string;
  domain: string;
  oidcConfig: string | null;
  samlConfig: string | null;
  requireSso: boolean;
  showOnSignIn: boolean;
  createAccounts: boolean;
  defaultGrants: InvitationGrant[];
  userId?: string | null | undefined;
}

/** SSO providers; better-auth's `sso` plugin reads the same rows. */
export class SsoProviderRepository extends Repository {
  list(): Promise<SsoProviderRow[]> {
    const { ssoProviders } = this.t;
    return this.db
      .select()
      .from(ssoProviders)
      .orderBy(asc(ssoProviders.name), asc(ssoProviders.id));
  }

  findById(id: string): Promise<SsoProviderRow | null> {
    return this.findOne(this.t.ssoProviders, id);
  }

  findByProviderId(providerId: string): Promise<SsoProviderRow | null> {
    const { ssoProviders } = this.t;
    return this.findOneWhere(ssoProviders, eq(ssoProviders.providerId, providerId));
  }

  /** Whether another provider uses `providerId`. */
  async providerIdTaken(providerId: string, exceptId?: string): Promise<boolean> {
    const { ssoProviders } = this.t;
    const row = await this.findOneWhere(
      ssoProviders,
      exceptId
        ? and(eq(ssoProviders.providerId, providerId), ne(ssoProviders.id, exceptId))
        : eq(ssoProviders.providerId, providerId),
    );
    return row !== null;
  }

  async create(data: SsoProviderWriteData): Promise<SsoProviderRow> {
    const [row] = await this.db.insert(this.t.ssoProviders).values(data).returning();
    return row as SsoProviderRow;
  }

  async update(id: string, data: Partial<SsoProviderWriteData>): Promise<SsoProviderRow | null> {
    const { ssoProviders } = this.t;
    const [row] = await this.db
      .update(ssoProviders)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(ssoProviders.id, id))
      .returning();
    return row ?? null;
  }

  delete(id: string): Promise<boolean> {
    return this.removeOne(this.t.ssoProviders, id);
  }

  /** The account signed in with `accountId` at the provider, if any. */
  async accountOwner(providerId: string, accountId: string): Promise<string | null> {
    const { accounts } = this.t;
    const [row] = await this.db
      .select({ userId: accounts.userId })
      .from(accounts)
      .where(and(eq(accounts.providerId, providerId), eq(accounts.accountId, accountId)))
      .limit(1);
    return row?.userId ?? null;
  }

  /** Unlinks every account from the provider. */
  async unlinkAccounts(providerId: string): Promise<void> {
    const { accounts } = this.t;
    await this.db.delete(accounts).where(eq(accounts.providerId, providerId));
  }
}
