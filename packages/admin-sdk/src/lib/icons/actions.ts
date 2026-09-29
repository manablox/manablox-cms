import type { IconifyIcon } from '@iconify/vue';
import { iconPack } from './pack';

/** Action icons, fetched with the first one shown; one file per icon in `actions/`. */
const ACTION_ICONS = iconPack(
  import.meta.glob<IconifyIcon>('./actions/*.ts', { eager: true, import: 'default' }),
);

export default ACTION_ICONS;
