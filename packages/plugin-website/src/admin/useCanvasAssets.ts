import type { ThemeDesign } from '@manablox/site';
import { computed, reactive, watch } from 'vue';
import { type CanvasAssets, fontAssetIds, mediaPath } from './model/canvas';

/** Loaded font files by asset id; shared, since a file never changes under its id. */
const loaded = reactive(new Map<string, string>());
const loading = new Set<string>();

async function load(assetId: string): Promise<void> {
  if (loaded.has(assetId) || loading.has(assetId)) return;
  loading.add(assetId);
  try {
    const response = await fetch(mediaPath(assetId), { credentials: 'include' });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([blob], { type: 'font/woff2' }));
    });
    loaded.set(assetId, url);
  } catch {
    // The face is left out; the fallback stack shows.
  } finally {
    loading.delete(assetId);
  }
}

/**
 * The canvas's view of the theme's assets: uploaded fonts are fetched from the admin's own
 * media route and inlined, images are linked there.
 */
export function useCanvasAssets(theme: () => ThemeDesign | null) {
  watch(
    () => (theme() ? fontAssetIds(theme() as ThemeDesign).join(' ') : ''),
    () => {
      const current = theme();
      if (current) for (const id of fontAssetIds(current)) void load(id);
    },
    { immediate: true },
  );
  return computed<CanvasAssets>(() => {
    // Read inside the computed, so a newly loaded file recompiles the stylesheet.
    const snapshot = new Map(loaded);
    return {
      fontData: (assetId) => snapshot.get(assetId) ?? null,
      mediaOrigin: window.location.origin,
    };
  });
}
