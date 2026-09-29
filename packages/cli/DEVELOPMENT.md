# `@manablox/cli`: development notes

How the CLI is put together. The user-facing summary is in `README.md`.

`start` and `migrate` load `manablox.config.ts` (or `--config <file>`) from the working
directory, plus a `.env` next to it, and boot `@manablox/server` with it. The two
scaffolding commands need neither a config nor the runtime, so the server, the database
and the job packages are imported on demand rather than at startup.

`src/main.ts` only dispatches. `src/args.ts` holds each command's options table, the
parser and the validators the commands share (`booleanFlag`, `validPort`, `validUrl`,
`validDomain`); each command body lives in `src/commands/`, and the help text in
`src/usage.ts`.

- `src/create/` writes a new CMS instance: config files, a `.env` with generated secrets,
  a compose stack, and optionally a Dockerfile and a Caddy or nginx config. The database
  is Postgres or SQLite (`--database`).
- `src/frontend/` writes a frontend for a space against the delivery API, in one of four
  shapes: plain Vite and TypeScript, Astro, Vite plus React with SSR, or Vite plus Vue
  with SSR. Every one of them renders documents by permalink, renders blocks through a
  registry, and carries a `/preview` route for the visual editor.

Both prompt for whatever the command line left open, and take the defaults when there is
no terminal or `--yes` is passed. The renderers are pure functions from the answers to a
list of files, which is what the tests read.

`manablox frontend` can also write a component for each content and block type of a
space. `src/frontend/source.ts` reads the model, from the management API with an API key
(`spaces/list`, then `contentTypes/list`) or from a delivery API's `/v1/types`, and
`src/frontend/model.ts` reduces either answer to the same shape: types, and for each
field what it renders as. `src/frontend/components/` writes the components from that,
one writer per framework plus the DOM writer that `plain` and Astro's preview canvas
share. Naming and field slots come from `components/codegen-common.ts`, the registry
modules of all four from `components/codegen-registry.ts`. What they add replaces the
template's registries and its example teaser.

## The templates

`templates/` holds the files a scaffold is made of, as the files they will become, with
`__TOKEN__`s where an answer belongs. The directory is the file list: adding a file to a
scaffold means adding the file. `src/template-files.ts` finds the directory beside `src/`
or `dist/` and fills a template in three passes: `{{#if flag}}`, `{{#if !flag}}`, `{{#else}}`
and `{{/if}}` first (nestable; a directive alone on its line takes the whole line with it,
one inside a line only takes itself), then the tokens, literally, then the `{{slot <name>}}`
lines: each becomes an anchor comment (`// manablox:slot <name>`, `#` or `<!-- -->` by the
file's type, indented like the slot line) followed by one marked region per plugin
fragment, the fragment rendered with the same flags and tokens (`src/regions.ts`). JSON has
no comments, so `package.json`'s slots take the fragments unmarked.

`templates/instance/` is what `manablox create` writes. Each file sits at the path it is
written to; `compose.yml` and `README.md` differ entirely between the presets, so they
live under `docker/` and `local/`. Dotfiles are stored without the dot (`env`, `gitignore`,
`dockerignore`) because npm-packlist would otherwise apply or drop them. `fragments/`
holds what is rendered on its own and inserted at a token: the nginx `server` group, once
per domain, and the mail section of the README. `src/create/templates.ts` is the file
list, the flags and tokens, and the computed mail driver table. `test/template-files.test.ts` renders the option matrix and asserts that no
token, block or slot survived.

Nothing in `templates/instance/` names a plugin. A plugin's part of an instance comes
from its CLI contribution (`src/plugins.ts` loads it, `FIRST_PARTY_PLUGINS` lists the ones
`create` offers; they are optional peers, installed on demand into the CLI's cache): whole
files, fragments for the slots, its own flags, tokens and secrets, and processes. The core
tokens and flags never depend on a plugin, so a plugin's part is exactly its marked regions:
its processes become regions too (`EXPOSE` in the Dockerfile, the restore script's process
list), and the read-only database role exists on Postgres either way. The plugin list lives
in `manablox.plugins.ts`, one import anchor for both configs. The premium plugins (website,
AI) are not in this repository; the tests use stand-ins for their packages
(`test/fixtures/packages/`, linked into the plugin cache by `test/setup.ts`) and render with
the website stand-in (`render()` in `test/helpers/create.ts`) and without it.

`manablox plugin` (`src/commands/plugins.ts`, `src/plugin/`) edits an existing instance with
the same renderer. `src/instance.ts` reads the create-time options back from the instance's
files; `planInstall` renders the instance with the plugin, takes the plugin's regions and
inserts each after its anchor in the real file (`insertRegion`), all or nothing per file;
`planUninstall` removes every region of the id (`removeRegions`). `package.json` is edited
as JSON: dependencies sorted, a plugin's scripts placed where `create` puts them. A file
without an anchor is never written; its parts are printed. `test/plugin-command.test.ts`
holds the round trip: create with every plugin, uninstall each, install each, byte for byte
the same files. `src/package-manager.ts` picks the instance's package manager.

`templates/<framework>/` is what `manablox frontend` writes - `templates/react-ssr/src/App.tsx`
is written to `src/App.tsx` - with `__MANABLOX_URL__`, `__EDITOR_ORIGIN__`, `__PORT__` and
`__NAME__` where an answer belongs. `templates/shared/` is what two frameworks emit byte
for byte, which is the stylesheet and the Express server, the latter with
`__SERVER_ENTRY__` for the one line that differs between React and Vue, the DOM renderers
(`shared/dom/`, placed at `src/` in `plain` and at `src/lib/preview/` in Astro), and
`fields.ts`, which only a frontend with components from a content model gets.
`__EXPAND__` is the list of relation fields a page asks the API to inline.
`templates/frontend-common/` is what every framework writes (README, `.env`, `.gitignore`,
`pnpm-workspace.yaml`), rendered with one flag per framework. What is left in
`src/frontend/templates/*.ts` is what has to be computed: `package.json`, `tsconfig.json`,
and which shared files a framework takes.

`src/versions.ts` holds every dependency range a scaffold writes. `test/versions.test.ts`
keeps the ones the workspace catalog also has equal to it; `@types/node` stays at the
`engines` floor on purpose, and the Vue and Astro frontends take the TypeScript of the
`vue` and `astro` named catalogs, because `vue-tsc` and `astro check` need TypeScript's
JavaScript API, which 7.x does not have.

The package ships `templates/` beside `dist/`. No compiler reads the templates - the
frontend ones import `react`, `vue` and `astro`, which this package does not depend on,
and the instance configs carry `{{#if}}` blocks - so what is checked is the output:
`test/frontend.test.ts` renders every framework with answers that are not the defaults
and asserts, among other things, that no placeholder survived.

The `bin` script registers `tsx` before loading anything, because `manablox.config.ts` is
imported rather than run and may use TypeScript syntax that Node's own type stripping
refuses. The published package is compiled, minified JavaScript and needs no loader.

## Test

```sh
pnpm --filter @manablox/cli test
```
