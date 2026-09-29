import type { ContentRecord } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { ContentRow, Repositories } from '@manablox/db';
import type { CredentialService } from '@manablox/services';
import type { WorkflowAbortContext, WorkflowActor, WorkflowRunContext } from '../../sdk.js';
import type { WorkflowActionServices, WorkflowLimits } from '../ports.js';
import type { WorkflowRegistry } from '../registry.js';
import type { RunLifecycle } from '../run-lifecycle.js';
import type { RunWalker } from '../walker/index.js';
import type { LiveTriggerIndex } from './live-index.js';

/** What the engine's parts share. */
export interface EngineContext {
  readonly manablox: Manablox;
  readonly repos: Repositories;
  readonly services: WorkflowActionServices;
  /** Actions and trigger kinds of every plugin. */
  readonly registry: WorkflowRegistry;
  readonly limits: WorkflowLimits;
  readonly credentials: CredentialService | null;
  readonly safeFetch: typeof fetch;
  readonly adminUrl: string;
  readonly now: () => Date;
  readonly abortCheckMs: number | undefined;
  readonly lifecycle: RunLifecycle;
  readonly triggers: LiveTriggerIndex;
  /** Walkers running in this process, so an abort reaches them at once. */
  readonly live: Map<string, RunWalker>;
  /** Run id -> the called run it is running through in this process. */
  readonly calling: Map<string, string>;
  /** Hands a queued run to a worker. */
  dispatch(runId: string): Promise<void>;
  /** Hands several queued runs over at once, e.g. in one queue round trip. */
  dispatchMany(runIds: readonly string[]): Promise<void>;
  /** Executes a queued or paused run in this process. */
  run(runId: string): Promise<void>;
}

/** A run context; whatever `overrides` leaves out is empty. */
export function runContext(
  base: Pick<WorkflowRunContext, 'event' | 'workflow' | 'space' | 'at'>,
  overrides: Partial<WorkflowRunContext> = {},
): WorkflowRunContext {
  return {
    payload: null,
    headers: null,
    content: null,
    previous: null,
    documents: [],
    actor: null,
    url: null,
    nodes: {},
    ...base,
    ...overrides,
  };
}

/** An abort context; whatever `overrides` leaves out is empty. */
export function abortContext(
  base: Pick<WorkflowAbortContext, 'event' | 'space' | 'at'>,
  overrides: Partial<WorkflowAbortContext> = {},
): WorkflowAbortContext {
  return {
    payload: null,
    headers: null,
    content: null,
    previous: null,
    data: null,
    actor: null,
    ...base,
    ...overrides,
  };
}

/** A row as plain JSON for templates, without search columns. */
export function serialise(row: ContentRecord | ContentRow): Record<string, unknown> {
  const { search: _search, searchText: _searchText, ...rest } = row as ContentRecord;
  return JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
}

export async function spaceInfo(
  ctx: EngineContext,
  spaceId: string,
): Promise<WorkflowRunContext['space']> {
  const space = await ctx.repos.spaces.findById(spaceId);
  return space
    ? { id: space.id, name: space.name, machineName: space.machineName, url: space.url }
    : { id: spaceId, name: '', machineName: '', url: '' };
}

export async function actorInfo(
  ctx: EngineContext,
  userId: string | null,
): Promise<WorkflowActor | null> {
  if (!userId) return null;
  const user = await ctx.repos.users.findById(userId);
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

/** The admin URL of a document; a staging one names its environment. */
export function documentUrl(
  ctx: EngineContext,
  contentId: string,
  environment?: WorkflowRunContext['environment'],
): string {
  const url = `${ctx.adminUrl.replace(/\/$/, '')}/content/${contentId}`;
  return environment ? `${url}?env=${environment.machineName}` : url;
}

/** The staging environment of a workflow or a start's source, for its runs' context; `{}` in production. */
export async function environmentInfo(
  ctx: EngineContext,
  row: { spaceId: string; environmentId: string },
): Promise<Pick<WorkflowRunContext, 'environment'>> {
  const scope = await ctx.repos.environments.resolve({
    spaceId: row.spaceId,
    environmentId: row.environmentId,
  });
  return scope && !scope.production
    ? { environment: { id: scope.environmentId, machineName: scope.machineName } }
    : {};
}
