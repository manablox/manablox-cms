import type { ContentTypeInput, ManabloxPlugin } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { CredentialService } from '@manablox/services';
import {
  createServiceContext,
  type ServiceContext,
  type ServiceContextOptions,
} from '@manablox/services/testing';
import type { WorkflowGraph, WorkflowTrigger } from '../../src/sdk.js';
import { workflowRepos } from '../../src/server/db/index.js';
import { WorkflowEngine, type WorkflowEngineOptions } from '../../src/server/engine/index.js';
import { workflowsPlugin } from '../../src/server/plugin.js';
import { WorkflowRegistry } from '../../src/server/registry.js';
import type { WorkflowsServices } from '../../src/server/services/index.js';
import {
  type WorkflowInput,
  type WorkflowRunRow,
  WorkflowService,
} from '../../src/server/services/workflow.service.js';

/** The engine's clock unless a test passes its own `now`. */
export const START = new Date('2026-09-06T14:29:30.000Z');

export interface HarnessOptions {
  /** Defaults to one field-less `page` type. */
  contentTypes?: ContentTypeInput[];
  /** Defaults to an admin URL for links in mails. */
  config?: ServiceContextOptions['config'];
  /** Configured next to the workflows plugin, e.g. ones contributing actions or trigger kinds. */
  plugins?: ManabloxPlugin[];
  /** Over credentials, the registry and the fixed `START` clock. */
  engine?: Omit<WorkflowEngineOptions, 'credentials'>;
  /** Whether the engine hears content events, as on a management instance; by default. */
  listen?: boolean;
}

export interface WorkflowHarness {
  ctx: ServiceContext;
  manablox: ServiceContext['manablox'];
  repos: ServiceContext['repos'];
  content: ServiceContext['content'];
  spaceId: string;
  /** The `page` type's id. */
  pageType: string;
  close: () => Promise<void>;
  credentials: CredentialService;
  /** Built from the configured plugins' contributions. */
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
  /** Creates a draft page of `typeId` (the `page` type by default). */
  page: (
    title: string,
    fields?: Record<string, unknown>,
    typeId?: string,
  ) => ReturnType<ServiceContext['content']['create']>;
  /** The latest runs with their logs, newest first. */
  runsOf: (workflowId: string) => Promise<WorkflowRunRow[]>;
}

/**
 * A service context with the workflows plugin configured and its services wired as in the
 * host, provided to the instance so its data provider and other plugins reach them.
 */
export async function createWorkflowHarness(
  name: string,
  options: HarnessOptions = {},
): Promise<WorkflowHarness> {
  const config = options.config ?? { server: { adminUrl: 'https://admin.test' } };
  const ctx = await createServiceContext(name, {
    fieldTypes: builtinFieldTypes,
    contentTypes: options.contentTypes ?? [{ name: 'page', fields: [] }],
    config: {
      ...config,
      plugins: [workflowsPlugin(), ...(options.plugins ?? []), ...(config.plugins ?? [])],
    },
  });
  const { manablox, repos, spaceId } = ctx;
  const credentials = new CredentialService(manablox, repos);
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
  const services: WorkflowsServices = {
    registry,
    engine,
    workflows: service,
    live: { publish: () => {}, subscribe: () => () => {} },
  };
  manablox.providePlugin('workflows', { services });
  if (options.listen ?? true) engine.listen();

  return {
    ctx,
    manablox,
    repos,
    content: ctx.content,
    spaceId,
    pageType: ctx.ids.page as string,
    close: ctx.close,
    credentials,
    registry,
    engine,
    service,
    workflow: (name, trigger, graph, extra = {}) =>
      service.create(
        spaceId,
        { name, trigger, ...graph, enabled: true, ...extra },
        { publish: true },
      ),
    page: (title, fields = {}, typeId = ctx.ids.page as string) =>
      ctx.content.create({
        spaceId,
        typeId,
        locale: 'en',
        title,
        slug: title.toLowerCase().replace(/\s+/g, '-'),
        fields,
      }),
    runsOf: async (workflowId) => {
      const page = await service.runHistory(spaceId, workflowId, {}, { limit: 50, offset: 0 });
      const runs = workflowRepos(repos).runs;
      const rows = await Promise.all(page.items.map((item) => runs.findById(item.id)));
      return rows.filter((row) => row !== null);
    },
  };
}
