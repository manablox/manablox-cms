import { type Manablox, uuidv7 } from '@manablox/core/node';
import { INSTANCE_ID_META_KEY, type Repositories } from '@manablox/db';

/**
 * Loads the instance's id onto `manablox.instance`. `manablox migrate` stores it; a database
 * migrated any other way gets it at its first boot on a role that may write.
 */
export async function loadInstance(manablox: Manablox, repos: Repositories): Promise<void> {
  const id = await repos.instanceMeta.setIfAbsent(INSTANCE_ID_META_KEY, uuidv7());
  manablox.setInstance({ id });
}
