import { useLocalStorage } from '@vueuse/core';
import { type Ref, ref } from 'vue';

/** A panel's name for its stored collapsed state and width, e.g. `sidebar` or a side list's key. */
export type PanelKey = string;

export function usePanel(key: PanelKey) {
  const collapsed = useLocalStorage<boolean>(`manablox.panel.${key}`, false);
  const toggle = () => {
    collapsed.value = !collapsed.value;
  };
  return { collapsed, toggle };
}

/** Side panel width bounds in pixels. */
export const PANEL_WIDTH = { default: 272, min: 200, max: 640 } as const;

export function clampPanelWidth(width: number): number {
  return Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, width)));
}

/** The panel being resized; its width transition is disabled meanwhile. */
export const resizingPanel = ref<PanelKey | null>(null);

/** One shared ref per panel, read by separate components. */
const widths = new Map<PanelKey, Ref<number>>();

export function usePanelWidth(key: PanelKey) {
  let width = widths.get(key);
  if (!width) {
    width = useLocalStorage<number>(`manablox.panel.${key}.width`, PANEL_WIDTH.default);
    // Clamp stored values that are out of range.
    width.value = clampPanelWidth(Number(width.value) || PANEL_WIDTH.default);
    widths.set(key, width);
  }
  return width;
}
