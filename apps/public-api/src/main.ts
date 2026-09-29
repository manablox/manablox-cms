import { run } from '@manablox/server';
import { config } from './config.js';

/** Public delivery instance; `server.mode` leaves management and drafts unmounted. */
await run(config);
