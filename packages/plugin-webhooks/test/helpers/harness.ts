import {
  WorkflowEngine,
  type WorkflowEngineOptions,
  type WorkflowGraph,
  type WorkflowInput,
  WorkflowRegistry,
  type WorkflowRunRow,
  WorkflowService,
  type WorkflowsServices,
  type WorkflowTrigger,
  workflowRepos,
  workflowsPlugin,
} from '@manablox/plugin-workflows';
import { CredentialService } from '@manablox/services';
import {
  createServiceContext,
  type ServiceContext,
  type ServiceContextOptions,
} from '@manablox/services/testing';
import { webhooksPlugin } from '../../src/server/plugin.js';
import type { WebhooksServices } from '../../src/server/services/index.js';
import { workflowListener } from '../../src/server/services/index.js';
import {
  type WebhookDelivery,
  WebhookService,
  type WebhookServiceOptions,
} from '../../src/server/services/webhook.service.js';

/** The engine's clock unless a test passes its own `now`. */
const START = new Date('2026-09-06T14:29:30.000Z');

export interface HarnessOptions {
  config?: ServiceContextOptions['config'];
  /** Defaults to one field-less `page` type. */
  contentTypes?: ServiceContextOptions['contentTypes'];
  /** Over credentials, the registry and the fixed `START` clock. */
  engine?: Omit<WorkflowEngineOptions, 'credentials'>;
  /** Over a queue into `queued` and credentials. */
  webhooks?: Partial<WebhookServiceOptions>;
  /** Whether the workflow engine hears content events, as on a management instance; by default. */
  listen?: boolean;
}

export interface WebhookHarness {
  ctx: ServiceContext;
  manablox: ServiceContext['manablox'];
  repos: ServiceContext['repos'];
  spaceId: string;
  close: () => Promise<void>;
  credentials: CredentialService;
  /** The plugin's endpoints, starting and aborting workflows on incoming calls. */
  webhooks: WebhookService;
  /** Deliveries the outgoing webhooks queued. */
  queued: WebhookDelivery[];
  registry: WorkflowRegistry;
  engine: WorkflowEngine;
  service: WorkflowService;
  /** Creates a switched-on workflow and publishes it. */
  workflow: (
    name: string,
    trigger: WorkflowTrigger,
    graph: WorkflowGraph,
    extra?: Partial<WorkflowInput>,
  ) => ReturnType<WorkflowService['create']>;
  /** The latest runs with their logs, newest first. */
  runsOf: (workflowId: string) => Promise<WorkflowRunRow[]>;
}

/**
 * A service context with the workflows and webhooks plugins configured and wired as in the
 * host: both plugins' services provided to the instance, so the trigger kinds create endpoints,
 * incoming calls start and abort runs and content changes queue outgoing deliveries.
 */
export async function createWebhookHarness(
  name: string,
  options: HarnessOptions = {},
): Promise<WebhookHarness> {
  const config = options.config ?? { server: { adminUrl: 'https://admin.test' } };
  const ctx = await createServiceContext(name, {
    fieldTypes: [],
    contentTypes: options.contentTypes ?? [{ name: 'page', fields: [] }],
    config: {
      ...config,
      plugins: [workflowsPlugin(), webhooksPlugin(), ...(config.plugins ?? [])],
    },
  });
  const { manablox, repos, spaceId } = ctx;
  const credentials = new CredentialService(manablox, repos);
  const queued: WebhookDelivery[] = [];
  const webhooks = new WebhookService(manablox, repos, {
    enqueue: async (deliveries) => {
      queued.push(...deliveries);
    },
    credentials,
    listener: workflowListener(manablox),
    ...options.webhooks,
  });

  const registry = WorkflowRegistry.fromPlugin(manablox, (point) =>
    manablox.plugin('workflows').contributions(point),
  );
  const engine = new WorkflowEngine(manablox, repos, {
    credentials,
    registry,
    now: () => START,
    ...options.engine,
  });
  const service = new WorkflowService(manablox, repos, engine, credentials);
  const workflows: WorkflowsServices = {
    registry,
    engine,
    workflows: service,
    live: { publish: () => {}, subscribe: () => () => {} },
  };
  manablox.providePlugin('workflows', { services: workflows });
  const own: WebhooksServices = {
    webhooks,
  };
  manablox.providePlugin('webhooks', { services: own });
  if (options.listen ?? true) engine.listen();

  return {
    ctx,
    manablox,
    repos,
    spaceId,
    close: ctx.close,
    credentials,
    webhooks,
    queued,
    registry,
    engine,
    service,
    workflow: (name, trigger, graph, extra = {}) =>
      service.create(
        spaceId,
        { name, trigger, ...graph, enabled: true, ...extra },
        { publish: true },
      ),
    runsOf: async (workflowId) => {
      const page = await service.runHistory(spaceId, workflowId, {}, { limit: 50, offset: 0 });
      const runs = workflowRepos(repos).runs;
      const rows = await Promise.all(page.items.map((item) => runs.findById(item.id)));
      return rows.filter((row) => row !== null);
    },
  };
}
