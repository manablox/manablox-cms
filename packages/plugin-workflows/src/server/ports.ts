/** What the engine hands actions: repositories, the content service, mail, push and the limits. */

import type { Repositories } from '@manablox/db';
import type { ContentService, Mailer, Pusher } from '@manablox/services';

/** The content writes the content actions make, straight on `ContentService`. */
export type WorkflowContentWrites = Pick<
  ContentService,
  'create' | 'update' | 'publish' | 'unpublish'
>;

/** How long runs may take and how much a crawl may read; the plugin's options. */
export interface WorkflowLimits {
  /** Seconds one run may take, delays excluded. */
  runTimeoutSeconds: number;
  /** Pages one crawl may fetch, whatever the node asks for. */
  maxCrawlPages: number;
}

/** What the engine hands every action; some are missing outside management instances. */
export interface WorkflowActionServices {
  repos: Repositories;
  mailer: Mailer | null;
  pusher: Pusher | null;
  content: WorkflowContentWrites | null;
  limits: WorkflowLimits;
}
