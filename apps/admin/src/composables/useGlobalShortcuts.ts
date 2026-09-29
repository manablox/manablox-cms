import { usePanel } from '@manablox/admin-sdk/composables/usePanel';
import { useShortcuts } from '@manablox/admin-sdk/composables/useShortcuts';
import { helpOpen, type Shortcut } from '@manablox/admin-sdk/lib/shortcuts';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { useUiStore } from '@manablox/admin-sdk/stores/ui';
import { type MaybeRefOrGetter, toValue } from 'vue';
import { useRouter } from 'vue-router';
import { useNavStore } from '~/stores/menu';

/** The current route's side panel, if any. */
export interface ActivePanel {
  label: string;
  collapsed: boolean;
  toggle: () => void;
}

/** App-wide shortcuts registered by the shell: `g` navigation and chrome toggles. */
export function useGlobalShortcuts(panel: MaybeRefOrGetter<ActivePanel | null>): void {
  const router = useRouter();
  const menu = useNavStore();
  const session = useSessionStore();
  const spaces = useSpaceStore();
  const ui = useUiStore();
  const sidebar = usePanel('sidebar');

  // Mirrors the sidebar's permission filter.
  useShortcuts(
    () => {
      const taken = new Set<string>();
      const list: Shortcut[] = [];
      const entries = [
        ...menu.items,
        { label: 'Notifications', to: '/notifications', shortcut: 'n' },
        { label: 'Your profile', to: '/profile', shortcut: 'p' },
      ];
      for (const item of entries) {
        const key = item.shortcut?.toLowerCase();
        if (key?.length !== 1 || taken.has(key)) continue;
        if (
          'permission' in item &&
          item.permission &&
          !session.can(item.permission, spaces.currentId)
        ) {
          continue;
        }
        taken.add(key);
        list.push({
          keys: `g ${key}`,
          label: `Go to ${item.label.toLowerCase()}`,
          run: () => void router.push(item.to),
        });
      }
      return list;
    },
    { group: 'Go to', order: 90 },
  );

  useShortcuts(
    () => [
      {
        keys: '?',
        label: 'Keyboard shortcuts',
        run: () => {
          helpOpen.value = true;
        },
      },
      {
        keys: '[',
        label: 'Toggle the sidebar',
        run: () => {
          if (ui.isWide) sidebar.toggle();
          else ui.navOpen = !ui.navOpen;
        },
      },
      {
        keys: ']',
        label: toValue(panel)
          ? `Toggle the ${toValue(panel)?.label.toLowerCase()} panel`
          : 'Toggle the side panel',
        enabled: () => toValue(panel) !== null,
        run: () => {
          const active = toValue(panel);
          if (!active) return;
          if (ui.isWide) active.toggle();
          else ui.panelOpen = !ui.panelOpen;
        },
      },
      {
        keys: 'Escape',
        label: 'Close the open drawer',
        enabled: () => ui.navOpen || ui.panelOpen,
        run: () => ui.closeDrawers(),
      },
    ],
    { group: 'Everywhere', order: 100 },
  );
}
