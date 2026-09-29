import {
  type Contribution,
  type FeatureKey,
  ManabloxError,
  pluginFeatureKey,
  pluginId,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { AnyWorkflowAction } from '../define/action.js';
import type {
  AnyWorkflowAbortTriggerKind,
  AnyWorkflowTriggerKind,
  WorkflowDesignHint,
  WorkflowFieldKindDefinition,
} from '../define/triggers.js';
import type { WorkflowActionMeta } from '../sdk/action.js';
import type { WorkflowTriggerSpec } from '../sdk/node-spec.js';
import type { WorkflowDataType } from '../sdk/workflow.js';
import { builtinActions } from './actions/index.js';
import { WORKFLOWS } from './keys.js';
import { BUILTIN_ABORT_TRIGGERS, BUILTIN_TRIGGERS } from './triggers.js';

/** Built-in and plugin actions, shared by the editor, validator and engine. */
export class WorkflowActionRegistry {
  private readonly byType = new Map<string, AnyWorkflowAction>();

  register(action: AnyWorkflowAction): void {
    if (this.byType.has(action.type)) {
      throw ManabloxError.badRequest('plugins.workflows.action.duplicate', { type: action.type });
    }
    this.byType.set(action.type, action);
  }

  /** Replaces an action of the same key. */
  replace(action: AnyWorkflowAction): void {
    this.byType.set(action.type, action);
  }

  /** Registers the built-ins after plugins, keeping keys a plugin already claimed. */
  registerDefaults(actions: readonly AnyWorkflowAction[]): void {
    for (const action of actions) {
      if (!this.byType.has(action.type)) this.byType.set(action.type, action);
    }
  }

  has(type: string): boolean {
    return this.byType.has(type);
  }

  tryGet(type: string): AnyWorkflowAction | undefined {
    return this.byType.get(type);
  }

  get(type: string): AnyWorkflowAction {
    const action = this.byType.get(type);
    if (!action) throw ManabloxError.badRequest('plugins.workflows.action.unknown', { type });
    return action;
  }

  get all(): AnyWorkflowAction[] {
    return [...this.byType.values()];
  }

  /** The catalogue the admin draws its palette and inspector from. */
  catalog(manablox: Manablox): WorkflowActionMeta[] {
    return this.all.map((action) => {
      const availability = action.isAvailable?.(manablox) ?? { ok: true as const };
      const {
        isAvailable: _isAvailable,
        defaults,
        validate: _validate,
        execute: _execute,
        ...meta
      } = action;
      return {
        ...meta,
        defaults: defaults() as Record<string, unknown>,
        available: availability.ok,
        unavailable: availability.ok ? null : availability.reason,
      } satisfies WorkflowActionMeta;
    });
  }

  /** The output type of one action, for the editor's port colouring. */
  outputType(type: string): WorkflowDataType {
    return this.byType.get(type)?.output.type ?? 'any';
  }
}

/** A trigger kind as the catalogue serves it. */
export interface WorkflowTriggerKindMeta extends WorkflowTriggerSpec {
  kind: string;
  /** The plugin that contributed it; `workflows` for the built-in ones. */
  plugin: string;
}

/** What the plugin's extension points hold, each entry with the plugin it came from. */
export interface WorkflowContributions {
  actions: readonly Contribution<AnyWorkflowAction>[];
  triggers: readonly Contribution<AnyWorkflowTriggerKind>[];
  abortTriggers: readonly Contribution<AnyWorkflowAbortTriggerKind>[];
  fieldKinds: readonly Contribution<WorkflowFieldKindDefinition>[];
  designHints: readonly Contribution<WorkflowDesignHint>[];
}

/**
 * Actions, trigger kinds, field kinds and design hints of every configured plugin, the
 * plugin's own built-ins included: they come through the same extension points. A kind or
 * action another plugin contributes under a built-in name replaces it.
 */
export class WorkflowRegistry {
  readonly actions = new WorkflowActionRegistry();
  private readonly triggers = new Map<string, Contribution<AnyWorkflowTriggerKind>>();
  private readonly aborts = new Map<string, Contribution<AnyWorkflowAbortTriggerKind>>();
  private readonly actionPlugins = new Map<string, string>();
  readonly fieldKinds: readonly WorkflowFieldKindDefinition[];
  readonly designHints: readonly WorkflowDesignHint[];

  constructor(
    contributions: WorkflowContributions,
    /** The flag of a configured plugin, by id. */
    private readonly featureOf: (plugin: string) => FeatureKey | undefined = () => undefined,
  ) {
    const own = <T>(list: readonly Contribution<T>[]) =>
      [...list].sort((a, b) => Number(b.plugin === WORKFLOWS) - Number(a.plugin === WORKFLOWS));
    for (const { plugin, entry } of own(contributions.actions)) {
      this.actions.replace(entry);
      this.actionPlugins.set(entry.type, plugin);
    }
    for (const contribution of own(contributions.triggers)) {
      this.triggers.set(contribution.entry.kind, contribution);
    }
    for (const contribution of own(contributions.abortTriggers)) {
      this.aborts.set(contribution.entry.kind, contribution);
    }
    this.fieldKinds = contributions.fieldKinds.map(({ entry }) => entry);
    this.designHints = contributions.designHints.map(({ entry }) => entry);
  }

  /** From a plugin's context; the workflows plugin's own built-ins come through it too. */
  static fromPlugin(
    manablox: Manablox,
    contributions: <T>(point: string) => readonly Contribution<T>[],
  ): WorkflowRegistry {
    const plugins = new Map(
      manablox.config.plugins.map((plugin) => [pluginId(plugin.name), plugin]),
    );
    return new WorkflowRegistry(
      {
        actions: contributions('actions'),
        triggers: contributions('triggers'),
        abortTriggers: contributions('abortTriggers'),
        fieldKinds: contributions('fieldKinds'),
        designHints: contributions('designHints'),
      },
      (id) => {
        const plugin = plugins.get(id);
        return plugin ? pluginFeatureKey(plugin) : undefined;
      },
    );
  }

  /** A trigger kind, or `undefined` when no configured plugin contributes it. */
  trigger(kind: string): AnyWorkflowTriggerKind | undefined {
    return this.triggers.get(kind)?.entry;
  }

  abortTrigger(kind: string): AnyWorkflowAbortTriggerKind | undefined {
    return this.aborts.get(kind)?.entry;
  }

  /** Every trigger kind, the built-in ones first. */
  get triggerKinds(): AnyWorkflowTriggerKind[] {
    return [...this.triggers.values()].map(({ entry }) => entry);
  }

  get abortTriggerKinds(): AnyWorkflowAbortTriggerKind[] {
    return [...this.aborts.values()].map(({ entry }) => entry);
  }

  /** The trigger kinds as the catalogue serves them. */
  triggerCatalog(): WorkflowTriggerKindMeta[] {
    return [...this.triggers.values()].map(({ plugin, entry }) => ({
      ...entry.spec,
      kind: entry.kind,
      plugin,
    }));
  }

  /** The flag of the plugin that contributed an action; `undefined` for this plugin's own. */
  actionFeature(type: string): FeatureKey | undefined {
    const plugin = this.actionPlugins.get(type);
    return plugin && plugin !== WORKFLOWS ? this.featureOf(plugin) : undefined;
  }
}

/** The plugin's own actions and trigger kinds, as it contributes them to itself. */
export const builtinContributions = () => ({
  actions: builtinActions(),
  triggers: BUILTIN_TRIGGERS,
  abortTriggers: BUILTIN_ABORT_TRIGGERS,
});

/** A registry of the built-in actions and kinds alone, e.g. for an engine without the plugin. */
export function builtinRegistry(): WorkflowRegistry {
  const own = <T>(entries: readonly T[]) => entries.map((entry) => ({ plugin: WORKFLOWS, entry }));
  const builtins = builtinContributions();
  return new WorkflowRegistry({
    actions: own(builtins.actions),
    triggers: own(builtins.triggers),
    abortTriggers: own(builtins.abortTriggers),
    fieldKinds: [],
    designHints: [],
  });
}
