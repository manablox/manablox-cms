import { SHARED_MODULES } from '@manablox/admin-plugin/vite';
import type { Plugin } from 'vite';

const PREFIX = 'virtual:manablox/shared/';

/** The chunk name of a shared module: `@tanstack/vue-query` is `shared-tanstack-vue-query`. */
const chunkName = (id: string) => `shared-${id.replace(/^@/, '').replace(/\//g, '-')}`;

/**
 * Emits one entry chunk per shared module, keeping its exports, and writes the import map
 * that points plugin bundles at them. Build only; the dev server has no plugin bundles.
 */
export function sharedModules(): Plugin {
  return {
    name: 'manablox:shared-modules',
    apply: 'build',

    buildStart() {
      for (const id of SHARED_MODULES) {
        this.emitFile({
          type: 'chunk',
          id: `${PREFIX}${id}`,
          name: chunkName(id),
          preserveSignature: 'strict',
        });
      }
    },

    resolveId(id) {
      return id.startsWith(PREFIX) ? `\0${id}` : null;
    },

    load(id) {
      if (!id.startsWith(`\0${PREFIX}`)) return null;
      const module = JSON.stringify(id.slice(PREFIX.length + 1));
      return `export * from ${module};\n`;
    },

    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        const chunks = Object.values(context.bundle ?? {});
        const imports: Record<string, string> = {};
        for (const id of SHARED_MODULES) {
          const chunk = chunks.find(
            (file) => file.type === 'chunk' && file.isEntry && file.name === chunkName(id),
          );
          if (!chunk) throw new Error(`shared module ${id} has no chunk`);
          imports[id] = `/${chunk.fileName}`;
        }
        return [
          {
            tag: 'script',
            attrs: { type: 'importmap' },
            children: JSON.stringify({ imports }),
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}
