import { readdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import type { Plugin } from 'vite';

const ID = 'virtual:manablox/icon-names';
const PACKS = ['eager', 'actions', 'subjects'] as const;
const ICONS = fileURLToPath(new URL('./src/lib/icons/', import.meta.url));

/** `virtual:manablox/icon-names`: each icon pack's file names, the icon names, without data. */
export function iconNames(): Plugin {
  return {
    name: 'manablox:icon-names',
    resolveId: (id) => (id === ID ? `\0${ID}` : null),
    load(id) {
      if (id !== `\0${ID}`) return null;
      const lines = PACKS.map((pack) => {
        const dir = `${ICONS}${pack}`;
        this.addWatchFile(dir);
        const names = readdirSync(dir)
          .filter((file) => file.endsWith('.ts'))
          .map((file) => file.slice(0, -'.ts'.length))
          .sort();
        return `export const ${pack} = ${JSON.stringify(names)};`;
      });
      return lines.join('\n');
    },
  };
}
