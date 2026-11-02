# `@manablox/plugin-website`

Designed websites for Manablox, as a plugin. It adds everything a space needs to be a
website without a frontend of your own:

- the visual designer in the admin: a theme, designs for blocks, pages, layouts and menus, and the site settings,
- starter themes and design presets, theme files to export and import, AI designs,
- the `website` server mode, which renders every designed space as HTML by the host name a visitor asks for, with sitemaps, robots, share links for drafts and password protection,
- forms in designs that store their submissions as data entries,
- the site's domains, verified like API hosts.

Install it in the management instance, the public API and the website process. Without
the plugin a space is content for your own frontend, and nothing of the website is shown.
The admin loads the plugin's screens at runtime, so the prebuilt `@manablox/admin` needs no
rebuild.

## Install

```sh
npm install @manablox/plugin-website
```

A project made with `manablox create` has it when the website was picked as a feature
(`--website`, or `website` in `--features`); nothing is preselected. Add it to an existing
project with `manablox plugin install website`.

## Usage

Add the plugin to the management instance's config:

```ts
import { defineConfig } from '@manablox/core';
import { websitePlugin } from '@manablox/plugin-website';

export default defineConfig({
  // database, auth, storage ...
  plugins: [
    websitePlugin({
      // Where the website process answers; the admin frames its design canvas there.
      url: process.env.SITE_URL,
      // Shared with the website process, which forwards form submissions with it.
      forms: { secret: process.env.SITE_FORMS_SECRET },
    }),
  ],
});
```

Run the website process with the same database, storage and `AUTH_SECRET`:

```ts
import { manabloxFields } from '@manablox/fields';
import { runWebsite, websiteProcessConfig } from '@manablox/plugin-website/site';

// Reads DATABASE_URL, AUTH_SECRET, PORT (3200), SITE_EDITOR_ORIGIN, SITE_FORMS_API_URL
// and SITE_FORMS_SECRET from the environment.
await runWebsite(websiteProcessConfig({ plugins: [manabloxFields()] }));
```

Or start it with the CLI: `manablox start --mode website`.

Add it to the public API's config too (`manablox.public.config.ts` in a project made with
`manablox create`), so REST and GraphQL deliver each block's `design`.

## Options of `websitePlugin`

- `url`: the website process origin. The admin frames the design canvas there.
- `editorOrigin`: the admin origins that may frame the canvas, on the website process.
- `cacheTtl`: how long pages stay in shared caches, in seconds. Falls back to `cache.ttl`.
- `rateLimit`: requests per IP on the website process. Falls back to `server.rateLimit`.
- `forms`: `apiUrl` (website process: where submissions are forwarded), `secret` (both processes, at least 16 characters), `rateLimit` and `timeout`.
- `themes`: themes of your own for the starter gallery, made with `defineTheme`.
- `renderer` and `forwarder`: replace how pages are rendered and form submissions are sent, mostly for tests.

## Entries

- `@manablox/plugin-website`: `websitePlugin`, `defineTheme`, the services and types.
- `@manablox/plugin-website/site`: `websiteProcessConfig` and `runWebsite` for the website process.
- `@manablox/plugin-website/sdk`: browser-safe types for frontends, such as `BlockInstanceDesign`.
- `@manablox/plugin-website/cli`: the plugin's part of the `manablox` command (see below).

## What it adds to an instance

- Tables `website_designs`, `website_design_versions` and `website_domains`, migrated after core.
- Permissions `website:read`, `website:write`, `website:publish`, `website:code` and `website:domains`.
- The feature flag `plugins.website`, with the features `forms`, `badge`, `password`, `headCode` and `shareLinks` under it, rate limits, a retention setting and the badge text and link.
- Procedures under `plugins.website` of the management API: `design`, `domains` and `settings`.
- The **Design** section of the admin, the design canvas in the document editor, the style panel of a block, the website step when a space is created, and the website settings and domains under **Settings > General** and **Settings > API hosts**.
- A block's design, stored at `ext.website` and delivered as `design`.

## On the command line

When your config loads the plugin, `manablox space create` and `manablox create` take the
website's options (`--website designed|external`, `--theme`, `--design` and
`--space-website`, `--space-theme`, `--space-design`, `--site-port`); the CLI's README lists
them. A new project includes the plugin and its site process only when the website is
picked (`--website` or `--features website`); nothing is preselected.

### `manablox website <command>`

Commands of the website plugin, for a project whose config includes it. They
work on the database of that config, like the admin does. `--space <name>` picks the space
by its technical name or id; with only one space it can be left out.

```sh
manablox website publish-all --space blog
manablox website domains list --space blog
manablox website domains add www.example.com --space blog --primary
manablox website domains verify www.example.com --space blog
manablox website domains remove www.example.com --space blog
```

| Command | What it does |
| --- | --- |
| `publish-all` | Publishes every design draft of the space at once, as Publish all in the admin does |
| `domains list` | Lists the space's site domains, which one is primary and whether it is verified |
| `domains add <hostname>` | Adds a site domain. `--primary` makes it the primary one. Prints the DNS TXT record that verifies it |
| `domains verify <hostname>` | Checks the domain's DNS records now; exits with 2 while it is not verified |
| `domains remove <hostname>` | Removes the site domain |

| Option | Default | Meaning |
| --- | --- | --- |
| `--space <name>` | the only space | The space, by technical name or id |
| `--primary`, `--no-primary` | `--no-primary` | `domains add`: make the domain the primary one |
| `--config <file>` | `manablox.config.ts` | The config file to read |

Other plugins can add commands the same way; `manablox --help` lists them.

The developer documentation's [Designed sites](https://dev.manablox.io/site/) section explains
the designer, themes, forms and running the website process.

## License

MIT, see `LICENSE`.
