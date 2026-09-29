import { type BuiltTables, buildTables, type DatabaseContext, Repository } from '@manablox/db';
import { asc, eq } from 'drizzle-orm';
import * as tables from './tables.js';

export type LicenseTables = BuiltTables<typeof tables>;

export type LicenseActivationRow = LicenseTables['licenseActivations']['$inferSelect'];
export type LicenseActivationInsert = LicenseTables['licenseActivations']['$inferInsert'];

/** What a write may change on a row. */
export type LicenseActivationPatch = Partial<
  Omit<LicenseActivationInsert, 'id' | 'keyHash' | 'createdAt' | 'updatedAt'>
>;

/** The instance's license keys and their activations. */
export class LicenseActivationRepository extends Repository<LicenseTables> {
  constructor(context: DatabaseContext) {
    super(context, buildTables(tables, context.dialect.name));
  }

  /** Every row, oldest first. */
  list(): Promise<LicenseActivationRow[]> {
    const { licenseActivations } = this.t;
    return this.db
      .select()
      .from(licenseActivations)
      .orderBy(asc(licenseActivations.createdAt), asc(licenseActivations.id));
  }

  findById(id: string): Promise<LicenseActivationRow | null> {
    return this.findOne(this.t.licenseActivations, id);
  }

  findByHash(keyHash: string): Promise<LicenseActivationRow | null> {
    const { licenseActivations } = this.t;
    return this.findOneWhere(licenseActivations, eq(licenseActivations.keyHash, keyHash));
  }

  async insert(data: LicenseActivationInsert): Promise<LicenseActivationRow> {
    const [row] = await this.db.insert(this.t.licenseActivations).values(data).returning();
    return row as LicenseActivationRow;
  }

  /** `null` when the row is gone. */
  async update(id: string, patch: LicenseActivationPatch): Promise<LicenseActivationRow | null> {
    const { licenseActivations } = this.t;
    const [row] = await this.db
      .update(licenseActivations)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(licenseActivations.id, id))
      .returning();
    return row ?? null;
  }

  remove(id: string): Promise<boolean> {
    return this.removeOne(this.t.licenseActivations, id);
  }
}
