<script setup lang="ts">
import ChipToggle from '@manablox/admin-sdk/components/ui/ChipToggle.vue';
import { computed } from 'vue';
import { type InventoryGroup, narrowedIds, pickedIds, toggled } from '../inventory';
import {
  isPickable,
  type TransferEntry,
  type TransferGroup,
  type TransferInventory,
  type TransferSection,
  type TransferSelection,
  transferGroups,
  transferSections,
  withDependencies,
} from '../transfer-sections';
import InventoryEntries from './InventoryEntries.vue';
import InventoryPicker from './InventoryPicker.vue';

/**
 * Picks what a transfer carries: sections, entries within them, and documents by type,
 * locale and status. The inventory comes from the space on export, the file on import.
 */
const props = defineProps<{
  inventory: TransferInventory | null;
  /** The sections worth offering: everything on export, what the file holds on import. */
  available: TransferSection[];
}>();
const selection = defineModel<TransferSelection>({ required: true });

const sections = computed(() =>
  transferSections().filter((section) => props.available.includes(section.kind)),
);

const isPicked = (section: TransferSection) => selection.value.sections.includes(section);

/** Disabled while the section it requires is unticked. */
function isDisabled(section: TransferSection): boolean {
  const meta = transferSections().find((s) => s.kind === section);
  return Boolean(meta?.requires && !isPicked(meta.requires));
}

function update(patch: Partial<TransferSelection>) {
  selection.value = { ...selection.value, ...patch };
}

/** Emits in canonical order. */
function setSections(picked: ReadonlySet<TransferSection>) {
  const kept = withDependencies(new Set(picked));
  update({
    sections: transferSections()
      .map((s) => s.kind)
      .filter((kind) => kept.has(kind)),
  });
}

/** Ticks all of a group, or none. */
function toggleGroup(group: TransferGroup) {
  const inGroup = sections.value.filter((section) => section.group === group);
  const next = new Set(selection.value.sections);
  const turningOn = !inGroup.every((section) => next.has(section.kind));
  for (const section of inGroup) {
    if (turningOn) next.add(section.kind);
    else next.delete(section.kind);
  }
  setSections(next);
}

const groupIsFull = (group: TransferGroup) =>
  sections.value.filter((s) => s.group === group).every((s) => isPicked(s.kind));

/** A section's entries, or none when it is not individually selectable. */
function entriesOf(section: TransferSection): TransferEntry[] {
  const inventory = props.inventory;
  if (!inventory || !isSelectable(section)) return [];
  if (section in inventory) return inventory[section as keyof TransferInventory] as TransferEntry[];
  return inventory.pluginEntries[section] ?? [];
}

const isSelectable = (section: TransferSection): boolean => isPickable(section);

/** Whether a row can expand to entries or document filters. */
function canNarrow(section: TransferSection): boolean {
  if (section === 'contents') return Boolean(props.inventory?.contents.total);
  return entriesOf(section).length > 0;
}

const pickedEntries = (section: TransferSection) =>
  pickedIds(selection.value.ids[section], entriesOf(section));

function setEntries(section: TransferSection, picked: ReadonlySet<string>) {
  update({ ids: narrowedIds(selection.value.ids, section, entriesOf(section), picked) });
}

function allEntries(section: TransferSection, on: boolean) {
  setEntries(section, on ? pickedIds(undefined, entriesOf(section)) : new Set());
}

type ContentKey = 'typeIds' | 'locales' | 'statuses';
type ContentGroup = 'types' | 'locales' | 'statuses';
const CONTENT_GROUPS: Array<{ id: ContentGroup; key: ContentKey; label: string; mono: boolean }> = [
  { id: 'types', key: 'typeIds', label: 'Content types', mono: false },
  { id: 'locales', key: 'locales', label: 'Locales', mono: true },
  { id: 'statuses', key: 'statuses', label: 'Status', mono: false },
];

function groupEntries(group: ContentGroup) {
  return props.inventory?.contents[group] ?? [];
}

function pickedGroup(group: ContentGroup, key: ContentKey): Set<string> {
  const chosen = selection.value.contents[key];
  return new Set(chosen?.length ? chosen : groupEntries(group).map((entry) => entry.id));
}

function toggleContent(group: ContentGroup, key: ContentKey, id: string) {
  const picked = pickedGroup(group, key);
  // An empty filter means no filter, so the last value cannot be unticked.
  if (picked.has(id) && picked.size === 1) return;
  const next = toggled(picked, id);
  const all = groupEntries(group);
  const contents = { ...selection.value.contents };
  // All picked clears the filter.
  if (next.size === all.length) delete contents[key];
  else contents[key] = all.filter((entry) => next.has(entry.id)).map((entry) => entry.id);
  update({ contents });
}

/** The last picked filter value, which cannot be unticked. */
function isLastPicked(group: ContentGroup, key: ContentKey, id: string): boolean {
  const picked = pickedGroup(group, key);
  return picked.size === 1 && picked.has(id);
}

/** Entry count beside a section's label. */
function held(section: TransferSection): number | null {
  if (!props.inventory) return null;
  if (section === 'contents') return props.inventory.contents.total;
  if (section === 'assets' || section === 'files') return props.inventory.assets;
  const entries = entriesOf(section);
  return entries.length ? entries.length : props.inventory.plugins[section] || null;
}

/** How far the section is narrowed; 'All' when it is not. */
function narrowing(section: TransferSection): string {
  if (section === 'contents') {
    const filters = CONTENT_GROUPS.filter(({ id, key }) => {
      const chosen = selection.value.contents[key];
      return chosen?.length && chosen.length !== groupEntries(id).length;
    });
    return filters.length ? `${filters.length} filter${filters.length > 1 ? 's' : ''}` : 'All';
  }
  const chosen = isSelectable(section) ? selection.value.ids[section] : undefined;
  if (!chosen) return 'All';
  return `${chosen.length} of ${entriesOf(section).length}`;
}

/** Only groups with something to show. */
const groups = computed<InventoryGroup<TransferSection>[]>(() =>
  transferGroups()
    .map((group) => ({
      id: group.id,
      label: group.label,
      hint: group.hint,
      rows: sections.value
        .filter((section) => section.group === group.id)
        .map((section) => {
          const narrowed = narrowing(section.kind) !== 'All';
          return {
            id: section.kind,
            label: section.label,
            description: section.description,
            icon: section.icon,
            picked: isPicked(section.kind),
            disabled: isDisabled(section.kind),
            expandable: canNarrow(section.kind),
            expandLabel: `Choose which ${section.label.toLowerCase()} travel`,
            badge: narrowed ? narrowing(section.kind) : held(section.kind),
            narrowed,
          };
        }),
    }))
    .filter((group) => group.rows.length),
);
</script>

<template>
  <InventoryPicker
    :groups="groups"
    :full="(group) => groupIsFull(group.id as TransferGroup)"
    @toggle="setSections(toggled(new Set(selection.sections), $event))"
    @toggle-group="toggleGroup($event.id as TransferGroup)"
  >
    <template #detail="{ row }">
      <!-- Documents are filtered, not picked individually. -->
      <template v-if="row.id === 'contents'">
        <div v-for="filter in CONTENT_GROUPS" :key="filter.id" class="mb-2 last:mb-0">
          <p class="mb-label mb-1">{{ filter.label }}</p>
          <div class="flex flex-wrap gap-1">
            <ChipToggle
              v-for="entry in groupEntries(filter.id)"
              :key="entry.id"
              :model-value="pickedGroup(filter.id, filter.key).has(entry.id)"
              :mono="filter.mono"
              :disabled="isLastPicked(filter.id, filter.key, entry.id)"
              @update:model-value="toggleContent(filter.id, filter.key, entry.id)"
            >
              {{ entry.label }}
              <span class="opacity-60">{{ entry.count }}</span>
            </ChipToggle>
          </div>
        </div>
        <p class="mb-hint">A document whose parent is left out is left out with it.</p>
      </template>

      <InventoryEntries
        v-else-if="isSelectable(row.id)"
        :entries="entriesOf(row.id)"
        :picked="pickedEntries(row.id)"
        verb="travel"
        @toggle="setEntries(row.id, toggled(pickedEntries(row.id), $event))"
        @all="allEntries(row.id, $event)"
      />
    </template>
  </InventoryPicker>
</template>
