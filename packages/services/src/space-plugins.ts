import {
  ManabloxError,
  type ManabloxPlugin,
  type PluginCreatedSpace,
  type PluginSpaceCreate,
  pluginFeatureKey,
  pluginId,
  validateStandard,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { TransactionRepositories } from '@manablox/db';

declare module '@manablox/core' {
  interface PluginSpaceCreateContext<S = unknown> {
    /** The create's transaction; plugin repositories built on it with `databaseContextOf` join it. */
    readonly repos: TransactionRepositories;
  }
}

/** Drafts of the plugins' create steps, by plugin id. */
export type SpacePluginDrafts = Record<string, unknown>;

/** A validated draft, ready to apply. */
export interface SpacePluginStep {
  plugin: ManabloxPlugin;
  step: PluginSpaceCreate;
  data: unknown;
}

/**
 * Checks each draft against its plugin: loaded with a `spaceCreate`, on for a new space (no
 * group yet, so the instance decides) and valid by its schema.
 */
export async function spacePluginSteps(
  manablox: Manablox,
  drafts: SpacePluginDrafts | undefined,
): Promise<SpacePluginStep[]> {
  const steps: SpacePluginStep[] = [];
  for (const [id, draft] of Object.entries(drafts ?? {})) {
    const plugin = manablox.config.plugins.find((entry) => pluginId(entry.name) === id);
    const step = plugin?.spaceCreate;
    if (!plugin || !step) throw ManabloxError.badRequest('space.plugin.unknown', { plugin: id });
    const feature = pluginFeatureKey(plugin);
    if (!(await manablox.controls.feature(null, feature)).enabled) {
      throw ManabloxError.forbidden('space.plugin.off', { plugin: id, feature });
    }
    let data = draft;
    if (step.schema) {
      const result = await validateStandard(step.schema, draft, 'space.plugin');
      if (!result.ok) {
        throw ManabloxError.validation(
          result.issues.map((issue) => ({
            ...issue,
            path: ['plugins', id, ...(issue.path ?? [])],
            params: { ...issue.params, plugin: id },
          })),
          'space.validation.failed',
        );
      }
      data = result.value;
    }
    steps.push({ plugin, step, data });
  }
  return steps;
}

/** Applies the steps in the create's transaction, in plugin order. */
export async function applySpacePluginSteps(
  manablox: Manablox,
  steps: readonly SpacePluginStep[],
  space: PluginCreatedSpace,
  actorId: string | null,
  repos: TransactionRepositories,
): Promise<void> {
  for (const { plugin, step, data } of steps) {
    await step.apply?.({ plugin: manablox.plugin(plugin.name), space, actorId, repos }, data);
  }
}

/**
 * Runs the steps' `afterCommit` in plugin order; resolves to their warnings. A throw is logged
 * and becomes a warning, since the space exists already.
 */
export async function finishSpacePluginSteps(
  manablox: Manablox,
  steps: readonly SpacePluginStep[],
  space: PluginCreatedSpace,
  actorId: string | null,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const { plugin, step, data } of steps) {
    if (!step.afterCommit) continue;
    const context = manablox.plugin(plugin.name);
    try {
      const warning = await step.afterCommit({ plugin: context, space, actorId }, data);
      if (warning) warnings.push(warning);
    } catch (error) {
      context.logger.error({ err: error, spaceId: space.id }, 'space create step failed');
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`The ${context.id} plugin could not finish setting up the space: ${message}`);
    }
  }
  return warnings;
}
