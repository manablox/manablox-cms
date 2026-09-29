/** Vite injects these; declared here so the app needs no `vite/client` types package. */
interface ImportMetaEnv {
  readonly VITE_MANABLOX_URL?: string;
  readonly VITE_MANABLOX_ADMIN_ORIGIN?: string;
  readonly VITE_MANABLOX_SPACE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
