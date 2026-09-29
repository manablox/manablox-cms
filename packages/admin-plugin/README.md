# `@manablox/admin-plugin`

Add your own pages, menu entries, field editors and panels to the Manablox admin.

An admin plugin is a small module that lists what it adds to the admin. You build it into
a bundle of its own with the preset from this package, and your server plugin names the
folder of that bundle. The prebuilt admin loads the bundle when it starts, so the admin
itself is never rebuilt.

## Install

```sh
npm install --save-dev @manablox/admin-plugin @manablox/admin-sdk vite @vitejs/plugin-vue tailwindcss @tailwindcss/vite
```

## Usage

The admin entry lists what the plugin adds:

```ts
// src/admin/index.ts
import { defineAdminPlugin } from '@manablox/admin-plugin';
import './style.css';

export default defineAdminPlugin({
  name: '@acme/seo',
  routes: [{ path: '/seo', name: 'seo', component: () => import('./SeoReport.vue') }],
  menu: [{ label: 'SEO', icon: 'eye', to: '/seo', group: 'content', order: 350, shortcut: 'e' }],
  slots: {
    'content.editor.actions': [{ component: () => import('./SeoScore.vue') }],
  },
});
```

Its stylesheet uses the admin's design tokens, with a prefix of your own:

```css
/* src/admin/style.css */
@import "@manablox/admin-plugin/tailwind.css" prefix(seo);
```

Every Tailwind class of the plugin then starts with that prefix, before any variant:

```vue
<div class="seo:flex seo:gap-2 seo:lg:grid seo:dark:bg-surface-900">
  <button class="mb-btn-primary">Check</button>
</div>
```

The prefix keeps the plugin's classes apart from the admin's and from other plugins', so
none overrides another. Use your plugin's id, or a short form of it, in lowercase letters
only; nothing checks that two plugins differ.
The admin's own classes (`mb-btn-primary`, `mb-card` and the rest) stay as they are.

Build it with the preset:

```ts
// vite.admin.config.ts
import { defineAdminPluginBuild } from '@manablox/admin-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig(
  defineAdminPluginBuild({ plugins: [vue(), tailwindcss()], sdkLevel: 1 }),
);
```

```sh
npx vite build --config vite.admin.config.ts
```

That writes `dist/admin`. The preset also works in a project with TypeScript 7: the Vue SFC
compiler resolves the types `defineProps<...>()` imports from other files with TypeScript's
programmatic API, which TypeScript 7 does not have, so the preset gives it the TypeScript 5.9
this package installs. Your config needs nothing for it.

Name the folder in your server plugin:

```ts
import { fileURLToPath } from 'node:url';
import { definePlugin } from '@manablox/core';

export const seoPlugin = () =>
  definePlugin({
    name: '@acme/seo',
    admin: { dir: fileURLToPath(new URL('../dist/admin', import.meta.url)) },
  });
```

## Type-checking admin code

`.vue` files are type-checked by vue-tsc, which needs TypeScript 5.9: it uses TypeScript's
programmatic API, which TypeScript 7 does not have yet. This package installs vue-tsc and
TypeScript 5.9 for you and runs them with its `manablox-vue-check` command, so your project
can keep TypeScript 7 for everything else and does not install `vue-tsc` itself.

Give the admin code a tsconfig of its own:

```jsonc
// tsconfig.admin.json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "jsx": "preserve",
    "types": ["vite/client"]
  },
  "include": ["src/admin/**/*.ts", "src/admin/**/*.vue"]
}
```

and check it with a script:

```json
{
  "scripts": {
    "typecheck:vue": "manablox-vue-check --noEmit -p tsconfig.admin.json"
  }
}
```

`manablox-vue-check` takes the options of `vue-tsc` (which are those of `tsc`) and exits
with its code: 0 without errors, 1 or 2 with them. It always runs the vue-tsc and TypeScript
installed with this package, whichever TypeScript your project has.

## What a plugin can add

| Key | Meaning |
| --- | --- |
| `name` | The plugin's name, the same as its server part's. Required |
| `feature` | Another feature switch for the whole plugin. Without it, the plugin answers to `plugins.<id>` |
| `routes` | New pages: `{ path, name, component, inSpace, feature, features, panel, section, editor }` |
| `menu` | Entries in the admin menu: `{ label, icon, to, group, order, permission, shortcut, feature }`. `group` is `content` (the default), `automation`, `structure` or `system`. `order` sorts within the group. `shortcut` is one letter, pressed after `g` |
| `fields.inputs`, `fields.settings` | The editor and the settings form of a field type, by the keys the field type names |
| `slots` | Components in named places of the admin's own screens, such as the document editor's header or the space settings, and in other plugins' slots, such as the workflows plugin's action forms (`workflows:nodeForm`) |
| `sidePanels` | Side lists shown beside the plugin's pages |
| `settingsSections` | Tabs of their own in Settings |
| `transferSections` | Your data provider sections in the export and import pickers, with their labels and group |
| `realtime` | What to do when another editor changes one of the plugin's records |
| `audit` | How the plugin's entries read in the activity log |
| `features` | Names of your features, for locks and notices |
| `permissionIcons` | Icons of your permission groups |
| `usage` | Names of your usage metrics and what stops when one is used up |
| `diffKinds` | Names of your data kinds in the list of changes an environment promote shows |
| `setup(context)` | Runs once when the admin starts, with `defineSlot` and `expose` for slots and apis other plugins use |

Components are loaded with `() => import(...)`, so they only load when they are shown.

## Functions

- `defineAdminPlugin(plugin)`: describes an admin plugin, with its types checked by TypeScript.
- `enabledSwitchOutcome`: an `audit.outcomes` entry that reads `on` or `off` from an `enabled` change.
- `defineAdminPluginBuild(options)` from `@manablox/admin-plugin/vite`: the Vite settings that build the bundle. `sdkLevel` (required) is the lowest admin SDK API level your plugin needs, usually the `SDK_API_LEVEL` exported by the `@manablox/admin-sdk` you build against. `entry` defaults to `src/admin/index.ts`, `outDir` to `dist/admin`; `plugins` are your Vite plugins. It leaves `vue`, `vue-router`, `@tanstack/vue-query`, `pinia`, `reka-ui` and `@manablox/admin-sdk` to the admin, which shares its own copies with every plugin.
- `adminSfcTypes()` from `@manablox/admin-plugin/vite`: a Vite plugin that has the Vue SFC compiler of `@vitejs/plugin-vue` resolve imported types with this package's TypeScript 5.9. `defineAdminPluginBuild` and `pluginAdminTestConfig` of `@manablox/config-vitest` add it; add it yourself only to another Vite config that compiles your `.vue` files.
- `manabloxAdminPlugins({ plugins })` from `@manablox/admin-plugin/vite`: lists admin plugin sources for the admin's development server, for hot reloading while you work on a plugin inside the Manablox repository. A production build of the admin ignores it.

## Good to know

- The admin refuses a bundle whose `sdkLevel` it does not support: a higher level needs a newer Manablox, a lower one an updated plugin.
- A bundle that fails to load is skipped; the rest of the admin keeps working, and superadmins see which plugin failed.
- The build stops when the stylesheet imports `@manablox/admin-plugin/tailwind.css` without `prefix(...)`, or when the built sheet has a Tailwind class without the prefix.
- The prefix also names the theme variables in the plugin's sheet, and each points at the admin's own: `--seo-color-brand-500` is `var(--color-brand-500)`. Your styles follow the admin's current values, dark mode included. In arbitrary values and your own CSS either name works.
- The theme is the admin's: its own colours (`surface`, `brand`, `iris`, `ochre`, `ok`, `warn`, `danger`, `white`, `black`), without Tailwind's colour palettes.
- A `group` or `peer` for prefixed variants is prefixed too: `seo:group` on the parent, `seo:group-hover:flex` inside it.
- Import the shared packages by their names only. A path inside one, such as `@manablox/admin-sdk/lib/api`, is not shared, and the build stops with a message.
