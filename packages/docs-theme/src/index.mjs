import { fileURLToPath } from 'node:url';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import { passthroughImageService } from 'astro/config';
import { rewriteMdLinks } from './rewrite-md-links.mjs';

export { rewriteMdLinks };

const own = (path) => fileURLToPath(new URL(path, import.meta.url));
const dependency = (specifier) => fileURLToPath(import.meta.resolve(specifier));

/**
 * The Astro config shared by the Manablox Starlight sites: the admin's fonts, palette and
 * logo, and relative `.md` links rewritten to routes. `DOCS_SITE_URL` and `DOCS_BASE_PATH`
 * override the origin and base path.
 *
 * @param {{
 *   title: string,
 *   description: string,
 *   siteUrl: string,
 *   sidebar: unknown[],
 *   contentRoot: string,
 *   repoUrl?: string,
 *   integrations?: unknown[],
 * }} options `contentRoot` is the folder the pages live in; with `repoUrl` a link leaving
 * it points at the repository, without one it fails the build. `integrations` run before
 * Starlight.
 */
export function docsConfig({
  title,
  description,
  siteUrl,
  sidebar,
  contentRoot,
  repoUrl,
  integrations = [],
}) {
  const base = process.env.DOCS_BASE_PATH ?? '/';

  return {
    site: process.env.DOCS_SITE_URL ?? siteUrl,
    base,
    // The pages carry only SVG diagrams, which need no optimising (and no sharp).
    image: { service: passthroughImageService() },
    markdown: {
      processor: unified({
        remarkPlugins: [rewriteMdLinks({ base, root: contentRoot, repoUrl })],
      }),
    },
    integrations: [
      ...integrations,
      starlight({
        title,
        description,
        logo: {
          light: own('./assets/logo-light.svg'),
          dark: own('./assets/logo-dark.svg'),
          replacesTitle: true,
          alt: 'Manablox',
        },
        customCss: [
          dependency('@fontsource-variable/manrope'),
          dependency('@fontsource-variable/bricolage-grotesque'),
          own('./theme.css'),
        ],
        sidebar,
        pagination: true,
      }),
    ],
  };
}
