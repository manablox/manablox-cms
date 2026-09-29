import type {
  AdminAudit,
  AdminAuditChange,
  AdminRealtimeHandler,
  AdminSettingsSection,
  AdminSlotEntry,
  AdminSlotId,
  AdminTransferSection,
} from '@manablox/admin-plugin';
import {
  lazyComponent as lazy,
  type PluginOwner,
  type PluginSlotEntry,
  type PluginSlotItem,
  registerSlotEntry,
  resetPluginSlots,
  slotEntries,
  useSlotEntries,
} from '@manablox/admin-sdk/lib/plugin-slots';
import type { RealtimeEvent } from '@manablox/core';
import type { Component, ComputedRef } from 'vue';
import { shallowRef } from 'vue';

export type { PluginOwner };

/** A slot entry as the admin renders it. */
export type SlotItem<K extends AdminSlotId = AdminSlotId> = PluginSlotItem<AdminSlotEntry<K>>;

/** Adds an entry to a core slot or a plugin-declared one; the store lives in the SDK. */
export function registerSlot<K extends AdminSlotId>(
  owner: PluginOwner,
  slot: K,
  entry: AdminSlotEntry<K>,
): void {
  registerSlotEntry(owner, slot, entry as unknown as PluginSlotEntry);
}

/** Every registered entry of `slot`, ungated. */
export function slotItems<K extends AdminSlotId>(slot: K): readonly SlotItem<K>[] {
  return slotEntries(slot) as unknown as readonly SlotItem<K>[];
}

/**
 * The entries of `slot` the viewer may see in the current space; `locked` keeps entries whose
 * feature is locked, for a host that draws the lock.
 */
export function useSlotItems<K extends AdminSlotId>(
  slot: K,
  options: { locked?: boolean } = {},
): ComputedRef<readonly SlotItem<K>[]> {
  return useSlotEntries(slot, options) as unknown as ComputedRef<readonly SlotItem<K>[]>;
}

/** A plugin side panel by its key (`<id>.<key>`). */
export function pluginSidePanel(key: string): SlotItem<'app.sidePanels'> | null {
  return slotItems('app.sidePanels').find((item) => item.key === key) ?? null;
}

/** Settings tabs from plugins, with their components; `id` is `<plugin id>.<id>`. */
export interface PluginSettingsSection extends Omit<AdminSettingsSection, 'component'> {
  plugin: string;
  component: Component;
  feature: string;
}

const settingsSections = shallowRef<readonly PluginSettingsSection[]>([]);

export function registerSettingsSection(owner: PluginOwner, section: AdminSettingsSection): void {
  const entry: PluginSettingsSection = {
    ...section,
    id: `${owner.id}.${section.id}`,
    plugin: owner.id,
    component: lazy(section.component),
    feature: section.feature ?? owner.feature,
  };
  settingsSections.value = [
    ...settingsSections.value.filter((other) => other.id !== entry.id),
    entry,
  ];
}

export function pluginSettingsSections(): readonly PluginSettingsSection[] {
  return settingsSections.value;
}

/** Transfer picker sections from plugins, in registration order. */
const transferSections = shallowRef<readonly AdminTransferSection[]>([]);

export function registerTransferSection(section: AdminTransferSection): void {
  transferSections.value = [
    ...transferSections.value.filter((other) => other.kind !== section.kind),
    section,
  ];
}

export function pluginTransferSections(): readonly AdminTransferSection[] {
  return transferSections.value;
}

const permissionIcons = new Map<string, string>();

export function registerPermissionIcons(icons: Record<string, string>): void {
  for (const [group, icon] of Object.entries(icons)) permissionIcons.set(group, icon);
}

/** A plugin's icon for a permission group, else null. */
export function pluginPermissionIcon(group: string): string | null {
  return permissionIcons.get(group) ?? null;
}

const usageMetrics = new Map<string, { label: string; blocked: string }>();

export function registerUsageMetrics(
  metrics: Record<string, { label: string; blocked: string }>,
): void {
  for (const [metric, texts] of Object.entries(metrics)) usageMetrics.set(metric, texts);
}

/** A plugin metric's name and what stops when it is used up, else null. */
export function pluginUsageMetric(metric: string): { label: string; blocked: string } | null {
  return usageMetrics.get(metric) ?? null;
}

const realtime = new Map<string, AdminRealtimeHandler[]>();

export function registerRealtime(targetKind: string, handler: AdminRealtimeHandler): void {
  realtime.set(targetKind, [...(realtime.get(targetKind) ?? []), handler]);
}

/** Hands a live event to the plugins that handle its target kind; true if any did. */
export function dispatchRealtime(event: RealtimeEvent): boolean {
  const handlers = realtime.get(event.targetKind) ?? [];
  for (const handler of handlers) {
    try {
      handler(event);
    } catch (error) {
      console.error(`realtime handler for ${event.targetKind} failed`, error);
    }
  }
  return handlers.length > 0;
}

type AuditEntity = NonNullable<AdminAudit['entities']>[string];
const auditEntities = new Map<string, AuditEntity>();
const auditActions = new Map<string, string>();
const auditVerbs = new Map<string, string>();
type AuditOutcome = NonNullable<AdminAudit['outcomes']>[string];
const auditOutcomes = new Map<string, AuditOutcome>();
type AuditActor = NonNullable<AdminAudit['actors']>[string];
const auditActors = new Map<string, AuditActor>();

export function registerAudit(audit: AdminAudit): void {
  for (const [kind, entity] of Object.entries(audit.entities ?? {}))
    auditEntities.set(kind, entity);
  for (const [action, label] of Object.entries(audit.actions ?? {}))
    auditActions.set(action, label);
  for (const [action, verb] of Object.entries(audit.verbs ?? {})) auditVerbs.set(action, verb);
  for (const [action, outcome] of Object.entries(audit.outcomes ?? {}))
    auditOutcomes.set(action, outcome);
  for (const [kind, actor] of Object.entries(audit.actors ?? {})) auditActors.set(kind, actor);
}

/** A plugin actor kind's name and icon, else null. */
export function pluginActor(kind: string): AuditActor | null {
  return auditActors.get(kind) ?? null;
}

/** A plugin's badge word for an action, else null. */
export function pluginVerb(action: string): string | null {
  return auditVerbs.get(action) ?? null;
}

/** A plugin's word beside an action's badge; undefined when no plugin declares one. */
export function pluginOutcome(
  action: string,
  meta: Record<string, unknown> | null,
  changes: readonly AdminAuditChange[] = [],
): string | null | undefined {
  const outcome = auditOutcomes.get(action);
  return outcome ? outcome(meta, changes) : undefined;
}

/** A plugin entity's label, else null. */
export function pluginEntityLabel(kind: string): string | null {
  return auditEntities.get(kind)?.label ?? null;
}

/** A plugin action's label, else null. */
export function pluginActionLabel(action: string): string | null {
  return auditActions.get(action) ?? null;
}

/** Where a plugin entity opens; undefined when no plugin declares the kind. */
export function pluginEntityRoute(
  kind: string,
  targetId: string | null,
  meta: Record<string, unknown> | null = null,
): string | null | undefined {
  const entity = auditEntities.get(kind);
  if (!entity) return undefined;
  return entity.route ? entity.route(targetId, meta) : null;
}

/** Every plugin action with a label, for the audit filter. */
export function pluginActionLabels(): ReadonlyMap<string, string> {
  return auditActions;
}

/** Drops everything registered; for tests. */
export function resetPluginRegistry(): void {
  resetPluginSlots();
  settingsSections.value = [];
  transferSections.value = [];
  permissionIcons.clear();
  usageMetrics.clear();
  realtime.clear();
  auditEntities.clear();
  auditActions.clear();
  auditVerbs.clear();
  auditOutcomes.clear();
}
