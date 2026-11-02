import type { Runtime } from '@manablox/server';
import type { WebsiteServices } from '../../src/index.js';

/** The website plugin's services of a booted runtime. */
export const websiteOf = (runtime: Pick<Runtime, 'manablox'>): WebsiteServices =>
  runtime.manablox.plugin<WebsiteServices>('website').services;
