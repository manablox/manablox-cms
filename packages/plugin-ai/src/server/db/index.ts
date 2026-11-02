import { pluginRepos } from '@manablox/db';
import { AiRepository } from './repository.js';

/** The plugin's repository on the connection or transaction `repos` is bound to. */
export const aiRepos = pluginRepos((context) => new AiRepository(context));

export * from './repository.js';
export * from './rows.js';
