import type { AdminSlotId, AdminSlotProps } from '@manablox/admin-plugin';
import SdkPluginSlot from '@manablox/admin-sdk/components/PluginSlot.vue';
import type { VNode } from 'vue';
import type { SlotItem } from '~/lib/plugins/registry';

/**
 * The SDK's `PluginSlot`, typed by the admin's slot ids: `props` and the default slot's
 * `items` follow `id`.
 */
export default SdkPluginSlot as unknown as <K extends AdminSlotId>(
  props: { id: K; props?: AdminSlotProps[K]; locked?: boolean },
  context?: { slots: { default?: (scope: { items: readonly SlotItem<K>[] }) => unknown } },
) => VNode;
