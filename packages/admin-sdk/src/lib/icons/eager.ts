import type { IconifyIcon } from '@iconify/vue';
import { iconPack } from './pack';

/** Shipped with the entry; one file per icon in `eager/`. */
export const EAGER_ICONS = iconPack(
  import.meta.glob<IconifyIcon>('./eager/*.ts', { eager: true, import: 'default' }),
);
