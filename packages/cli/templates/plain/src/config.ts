/**
 * Every value here is public. No API key, no preview token: this app talks to the
 * delivery API, which has no draft path to unlock, and that is what makes shipping the
 * built bundle to a CDN safe.
 */
export const config = {
  url: import.meta.env.VITE_MANABLOX_URL ?? '__MANABLOX_URL__',
  /** The visual editor's origin, for the preview channel's origin check. */
  editorOrigin: import.meta.env.VITE_MANABLOX_ADMIN_ORIGIN ?? '__EDITOR_ORIGIN__',
  /** Only meaningful against a management instance; a public one pins its own space. */
  spaceId: import.meta.env.VITE_MANABLOX_SPACE_ID || undefined,
  previewPath: '/preview',
} as const;
