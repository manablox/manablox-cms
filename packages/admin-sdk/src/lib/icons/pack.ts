import type { IconifyIcon } from '@iconify/vue';

/** An eager glob of icon files keyed by icon name: `./actions/copy.ts` is `copy`. */
export function iconPack(modules: Record<string, IconifyIcon>): Record<string, IconifyIcon> {
  return Object.fromEntries(
    Object.entries(modules).map(([path, data]) => [
      path.slice(path.lastIndexOf('/') + 1, -'.ts'.length),
      data,
    ]),
  );
}
