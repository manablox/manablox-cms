import { runWebsite } from '@manablox/plugin-website/site';
import { config } from './config.js';

/** Designed sites: the website mode renders spaces by `Host` and mounts no API. */
await runWebsite(config);
