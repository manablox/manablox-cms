import type { TransactionRepositories } from '@manablox/db';
import { credentialAuditor } from '../../lib.js';
import type { SpaceExport } from '../format.js';

/** Audit meta of rows a space import writes, as the workflow import records them. */
const IMPORTED = { via: 'space.import' };

type Credential = NonNullable<SpaceExport['credentials']>[number];

/** Restores credentials without secrets; returns the ids written. */
export async function importCredentials(
  tx: TransactionRepositories,
  spaceId: string,
  credentials: Credential[],
): Promise<Set<string>> {
  const credentialAudit = credentialAuditor(tx);
  for (const credential of credentials) {
    // `data` stays null; the ciphertext is sealed per instance.
    const row = await tx.credentials.create({
      ...credential,
      spaceId,
      data: null,
      hint: null,
    });
    await credentialAudit.record('credential.create', row, undefined, IMPORTED);
  }
  return new Set(credentials.map((credential) => credential.id));
}
