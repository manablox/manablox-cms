import { posix } from 'node:path';
import { visit } from 'unist-util-visit';

/**
 * Rewrites relative `.md` links to site routes, e.g. `./run-the-stack.md` to
 * `/getting-started/run-the-stack/`, so pages link to each other by file. A link leaving
 * `root` points at the file in `repoUrl`, or fails the build without one. Root-relative
 * image URLs get the base path.
 *
 * @param {{ base?: string, root: string, repoUrl?: string }} options
 */
export function rewriteMdLinks({ base = '/', root, repoUrl }) {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const rootPath = posix.normalize(root.replace(/\\/g, '/'));

  return () => (tree, file) => {
    const pagePath = (file.path ?? file.history?.[0] ?? '').replace(/\\/g, '/');
    // Relative to `root`; `'.'` at the root.
    const pageDir = pagePath ? posix.relative(rootPath, posix.dirname(pagePath)) : '.';

    // Root-relative images are files in the site's `public/`.
    visit(tree, 'image', (node) => {
      if (node.url.startsWith('/') && !node.url.startsWith('//')) {
        node.url = `${prefix}${node.url.slice(1)}`;
      }
    });

    visit(tree, 'link', (node) => {
      if (/^[a-z]+:/i.test(node.url) || node.url.startsWith('#')) return;

      const match = /^([\w./-]+?)\.md(#.*)?$/.exec(node.url);
      if (!match) return;
      const [, target, hash = ''] = match;

      const resolved = posix.normalize(posix.join(pageDir, target));
      if (resolved.startsWith('../')) {
        if (!repoUrl) throw new Error(`${pagePath}: link ${node.url} leaves the documentation`);
        node.url = `${repoUrl.replace(/\/$/, '')}/blob/main/${resolved.replace(/^(\.\.\/)+/, '')}.md${hash}`;
        return;
      }

      const segments = resolved.split('/').filter((segment) => segment && segment !== '.');
      const last = segments.at(-1)?.toLowerCase();
      if (last === 'readme' || last === 'index') segments.pop();
      const slug = segments.length ? `${segments.join('/')}/` : '';
      node.url = `${prefix}${slug}${hash}`;
    });
  };
}
