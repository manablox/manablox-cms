# `@manablox/docs-theme`

The parts the two Starlight sites share, the developer docs (dev.manablox.io) and the user
guide (docs.manablox.io).

```js
import { docsConfig } from '@manablox/docs-theme';
import { defineConfig } from 'astro/config';

export default defineConfig(
  docsConfig({
    title: 'Manablox',
    description: 'A configurable, headless CMS.',
    siteUrl: 'http://localhost:3004',
    contentRoot: fileURLToPath(new URL('./docs', import.meta.url)),
    repoUrl: 'https://github.com/manablox/manablox-dev-docs',
    sidebar: [],
  }),
);
```

`docsConfig()` returns the Astro config: Starlight with the admin's typefaces, palette
(`src/theme.css`) and logo (`src/assets/`), pagination, and the remark plugin
(`src/rewrite-md-links.mjs`) that turns relative `.md` links into site routes.

The options are what differs per site:

- `title`, `description`: the Starlight title and meta description.
- `siteUrl`: the origin when `DOCS_SITE_URL` is not set. `DOCS_BASE_PATH` sets the base path.
- `sidebar`: the Starlight sidebar.
- `contentRoot`: the folder the markdown pages live in; links are resolved against it.
- `repoUrl`: where a link leaving `contentRoot` points (`<repoUrl>/blob/main/<path>`). Without it such a link fails the build.
- `integrations`: Astro integrations that must run before Starlight, such as `astro-mermaid`.

Images go through Astro's passthrough image service: the pages carry only SVG diagrams.
The `typescript` dev dependency (the `astro` catalog) keeps pnpm resolving the same
Starlight instance the sites use.
