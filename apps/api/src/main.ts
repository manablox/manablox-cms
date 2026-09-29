import { run } from '@manablox/server';
import { config } from './config.js';

await run(config, { label: 'manablox api' });
