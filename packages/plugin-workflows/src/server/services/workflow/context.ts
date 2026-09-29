import { ManabloxError, type ResolvedScope, type Scope, scopeSpaceId } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { CredentialRow, Repositories } from '@manablox/db';
import type { CredentialService } from '@manablox/services';
import { requireInSpace, resolveScope } from '@manablox/services';
import type { WorkflowTriggerContext } from '../../../define/triggers.js';
import type { workflowAuditor } from '../../audit.js';
import type { WorkflowRow, WorkflowSummary } from '../../db/index.js';
import { workflowRepos } from '../../db/index.js';
import type { WorkflowEngine } from '../../engine/index.js';
import type { WorkflowRegistry } from '../../registry.js';
import type { ValidationEnvironment } from '../../validate/index.js';

/** What the service's parts share, bound to one set of repositories. */
export interface WorkflowContext {
  manablox: Manablox;
  repos: Repositories;
  engine: WorkflowEngine;
  registry: WorkflowRegistry;
  /** The vault; `null` outside a management instance. */
  credentials: CredentialService | null;
  audit: ReturnType<typeof workflowAuditor>;
}

/** What `spaceLookups` reads. */
export interface SpaceLookups {
  /** The environment the lookups are of; a space id alone is production. */
  scope: string | ResolvedScope;
  /** A staging environment's machine name; `null` in production. */
  environment: string | null;
  credentials: CredentialRow[];
  workflows: WorkflowSummary[];
  /** What each trigger kind's `lookup` found, by kind. */
  triggers: Map<string, unknown>;
}

/** Scheduler bookkeeping, excluded from audit diffs. */
export const WORKFLOW_DIFF = { ignore: ['lastScheduledAt', 'lastRunAt'] };

/** Code workflows are read-only, except for the enabled switch. */
export function assertNotCode(row: WorkflowRow): void {
  if (row.source === 'code') {
    throw ManabloxError.forbidden('plugins.workflows.code.immutable', {
      name: row.name,
      sourceRef: row.sourceRef,
    });
  }
}

export async function find(ctx: WorkflowContext, scope: Scope, id: string): Promise<WorkflowRow> {
  return requireInSpace(
    await workflowRepos(ctx.repos).workflows.findById(id),
    scope,
    'plugins.workflows.notFound',
    { id },
  );
}

/** The vault, which only a management instance has. */
export function vault(ctx: WorkflowContext): CredentialService {
  if (!ctx.credentials) throw ManabloxError.unavailable('service.unavailable');
  return ctx.credentials;
}

/** Each trigger kind's `lookup` for the environment; a kind and its abort kind share one. */
async function triggerLookups(
  registry: WorkflowRegistry,
  context: WorkflowTriggerContext,
): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  for (const kind of [...registry.triggerKinds, ...registry.abortTriggerKinds]) {
    if (out.has(kind.kind) || !kind.lookup) continue;
    out.set(kind.kind, await kind.lookup(context));
  }
  return out;
}

/**
 * An environment's credentials (shared by the space), workflow summaries and what the trigger
 * kinds check against, read once per request.
 */
export async function spaceLookups(ctx: WorkflowContext, scope: Scope): Promise<SpaceLookups> {
  const [resolved, credentials, workflows, triggers] = await Promise.all([
    resolveScope(ctx.repos, scope),
    ctx.repos.credentials.listBySpace(scopeSpaceId(scope)),
    workflowRepos(ctx.repos).workflows.listSummariesBySpace(scope),
    triggerLookups(ctx.registry, { manablox: ctx.manablox, repos: ctx.repos, scope }),
  ]);
  const environment =
    typeof resolved !== 'string' && !resolved.production ? resolved.machineName : null;
  return { scope: resolved, environment, credentials, workflows, triggers };
}

/** Lookups validation needs, loaded once per save. */
export async function environment(
  ctx: WorkflowContext,
  scope: Scope,
): Promise<ValidationEnvironment> {
  return environmentOf(ctx, await spaceLookups(ctx, scope));
}

export function environmentOf(ctx: WorkflowContext, lookups: SpaceLookups): ValidationEnvironment {
  const credentials = new Map(lookups.credentials.map((row) => [row.id, row.kind]));
  const triggers = new Map(lookups.workflows.map((row) => [row.id, row.trigger]));
  const registry = ctx.manablox.contentTypes;
  return {
    typeExists: (typeId: string) => {
      const type = registry.tryGet(typeId);
      return type !== undefined && registry.inScope(type, lookups.scope);
    },
    credentialKind: (id: string) => credentials.get(id) ?? null,
    triggerData: (kind: string) => lookups.triggers.get(kind),
    workflowTrigger: (id: string) => triggers.get(id) ?? null,
  };
}
