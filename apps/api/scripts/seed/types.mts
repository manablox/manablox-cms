/**
 * The handful of types the seed needs, read off the runtime rather than imported from
 * the packages that define them: `apps/api` depends on `@manablox/server`, not on the
 * media service or the database layer, and a development script is no reason to widen
 * that.
 */
import type { WebhookService } from '@manablox/plugin-webhooks';
import type { WorkflowService } from '@manablox/plugin-workflows';
import type { ManagementRuntime as Runtime } from '@manablox/server';

export type Media = Runtime['media'];
export type Asset = Awaited<ReturnType<Media['upload']>>;
export type Content = Runtime['content'];
export type ContentRow = Awaited<ReturnType<Content['create']>>;
export type Menus = Runtime['menus'];
/** The workflows plugin's service, reached through the plugin's services. */
export type Workflows = WorkflowService;
/** The webhooks plugin's endpoint service. */
export type Webhooks = WebhookService;
export type Credentials = Runtime['credentials'];
