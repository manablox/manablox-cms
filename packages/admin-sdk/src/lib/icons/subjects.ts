import type { IconifyIcon } from '@iconify/vue';
import { iconPack } from './pack';

/** Subject icons for content types, fetched with the first one shown; one file per icon in `subjects/`. */
const SUBJECT_ICONS = iconPack(
  import.meta.glob<IconifyIcon>('./subjects/*.ts', { eager: true, import: 'default' }),
);

export default SUBJECT_ICONS;
