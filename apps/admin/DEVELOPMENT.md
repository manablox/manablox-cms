# `@manablox/admin`: development notes

How the admin is built and the rules every screen follows. The user-facing summary is in
`README.md`.

## Where things live

| Folder | What is in it |
| --- | --- |
| `features/<name>/` | One feature: `components/`, `queries.ts`, `model.ts` (types, constants, pure logic) and `use*.ts` composables at its root |
| `components/ui/` | Presentational controls; imports nothing from `features/`, `stores/` or `pages/` |
| `components/` | Shell chrome (sidebar, topbar, panels, dialogs), the field inputs (`fields/`) and pickers several features share (`ContentPicker`, `RoleSelect`, `PermissionPicker`, `TagInput`, `TagFilter`, `ai/`) |
| `lib/` | Utilities shared by several features: the API client, query keys, messages, formatting; imports nothing from `features/` |
| `pages/` | A page arranges features; it holds no logic of its own |

The public part of this layout lives in `packages/admin-sdk/src` (`@manablox/admin-sdk`),
in the same folders: `components/ui/`, the shared pickers, `lib/` (client, queries,
messages, format, write), `stores/space` and `stores/session`, the composables plugins use
and the content, asset, menu and content type queries. The admin imports those files by
path (`@manablox/admin-sdk/lib/toast`); plugins import only the package's main entry,
`src/index.ts`, which is its versioned surface. SDK files import each other relatively and
never import from `apps/admin`. The style tokens and component layers are
`packages/admin-sdk/src/styles/`; `src/style.css` here adds Tailwind and the fonts.
`pnpm admin:styles`, `admin:layout` and `admin:models` check both trees.

The rule: a file that serves one feature lives under `features/<name>/`, its helpers at
the feature's root next to `queries.ts` (no `lib/` folder). A feature imports another
feature's `queries` or `model`, never its `components/`; a component two features need is
shared by moving it to `components/`. Three one-way dependencies may use components:
workflows -> webhooks, workflows -> credentials and webhooks -> credentials; nothing
points back. A feature component takes its domain types from the feature's `queries.ts`
when it re-exports them, else from `lib/api-types.ts` (another feature's types, and a
file `queries.ts` itself imports). `pnpm admin:layout` at the root checks this.

## How it is shipped

The npm package contains `dist/` and nothing else. `@manablox/server` serves that build at
`/` when `server.admin` is set, so a project that installs Manablox gets the admin without
installing Vite or Vue.

`pnpm build` produces that bundle. Plugins are never built into it: on boot the admin
fetches `/admin/plugins.json` and imports each plugin's prebuilt bundle before the router
starts (`src/features/plugins/`: `boot.ts` fetches and checks, `loader.ts` imports,
`install.ts` adds routes, menu entries and registry entries). `shared-modules.ts` emits an
entry chunk each for `vue`, `vue-router`, `@tanstack/vue-query`, `pinia`, `reka-ui` and
`@manablox/admin-sdk` and writes the import map plugin bundles resolve them through; the
server allows that inline script by its hash. `manabloxAdminPlugins` in `vite.config.ts`
lists the first-party plugins' admin sources (`@manablox/plugin-<id>/admin-src`) for the dev
server only, so their code reloads with HMR. A build contains no plugin code; each plugin
ships its own bundle in `packages/plugin-<id>/dist/admin` (`pnpm --filter
@manablox/plugin-<id> build:admin`), which the API serves at `/admin/plugins/<id>/...`. To try
the prebuilt admin with them, build them and run the API with `server.admin` set. Slot
outlets are `<PluginSlot id :props>` (`src/components/PluginSlot.ts`, the SDK's component
typed by slot id), fed by `src/lib/plugins/registry.ts`. See
https://dev.manablox.io/extending/admin-plugins/ and ADR 0016.

## Depends on

@manablox/admin-sdk, @manablox/admin-plugin, @manablox/live-preview; in development also
the first-party plugins (their admin sources)

## Test

```sh
pnpm --filter @manablox/admin test        # unit tests, Vitest and happy-dom
pnpm --filter @manablox/admin test:e2e    # Playwright: install, the smoke test, controls, plugins
```

`test:e2e` boots the API (with a test license, `start:licensed`) and the admin against a
throwaway `manablox_e2e` database, with Redis db 13 on localhost (`E2E_REDIS_URL`, `off`
runs without). Two more instances serve the prebuilt admin: one with the fixture plugins of
`e2e/fixtures/runtime-plugins`, whose bundles load at runtime, and one with the core alone.
With the Docker stack on the default ports, move them:

```sh
E2E_API_URL=http://localhost:3010 E2E_ADMIN_URL=http://localhost:3011 \
E2E_PLUGINS_URL=http://localhost:3014 E2E_CORE_URL=http://localhost:3015 \
pnpm --filter @manablox/admin test:e2e
```

`--project chromium --no-deps` with `E2E_EXTERNAL=1` reruns only the smoke test against
servers you started, once the install step's account exists.

## Building screens

The admin is built from a small set of primitives, and every screen of a kind is built the
same way. New code follows the shape; a screen that differs is a bug, not a variation.
`pnpm admin:styles` flags the hand-built versions of most of them.

- **Controls** - `components/ui/`, all bound with `v-model` (`defineModel`). A control
  bound with `:model-value` alone keeps a local copy after a change, so a controlled use
  binds `@update:model-value` too (`pnpm admin:models` flags one that does not, unless it
  is `readonly` or `disabled`). Text is
  `TextField` / `TextareaField`, numbers are `NumberField` (emits numbers, empty is
  `undefined`), anything else sits in a `FormField` slot. A boolean is a `Switch` in a
  settings context and a `CheckCard` when it carries a hint; a choice of 2-5 is a
  `SegmentedControl`; a multi-pick from a short list is `ChipToggle`; longer lists use
  `Select`, `LocalePicker` or `MimeTypePicker`. `Select` is generic over its option values
  (strings, numbers or `null` for "none") and emits the picked option's own value, so
  type the options (`SelectOption<T>`, `as const`) rather than casting in the handler. Name/value rows are `KeyValueList`, short
  string lists `StringList`. Tabs are `Tabs`. A search box is `SearchField` (debounced
  `v-model`, `shortcut` binds `/`). Empty lists are `EmptyState` with an icon, a sentence
  and at most one action. Rows of a list that picks something are `NavList` /
  `NavListItem`. Anything floating over the page is a `Popover` or a `DropdownMenu`, and
  anything modal is `Dialog`; no `fixed` overlay lives outside `components/ui`.
- **Data** - a fetched list goes through `AsyncList` (pass `isPending`, `error` and
  `refetch` as `retry`); a table through `DataTable` (columns, `SortHeader` with `useSort`,
  `rowTo` or `@row-click`, optional checkbox column); JSON through `JsonBlock`. A landing
  card opens with `SectionIntro` (tile, heading with count, blurb).
- **Pages and editors** - a page states its loading, load error and missing record with
  `PageState` (`ready`, `loading`, `error`, `retry`, `notFound`); nothing renders blank or
  redirects silently. A routed page renders one root element (the shell switches pages
  with an out-in transition, which never finishes on a fragment and leaves the page
  blank): no top-level comment or second node, and a component at the root must itself
  have one root element, as `PageState` does. An editor page is `EditorHeader` (eyebrow - title - `StatusBadge` -
  actions right: secondary, primary, destructive) over `EditorLayout` (main column,
  `20rem` aside, side by side from `lg`). Its state is `useEditorForm({ source, toDraft,
  what, crumb, save })`: the draft reloads from `source` without losing edits, and the
  unsaved guard, breadcrumb, `Mod+S` and `otherErrors` come with it. Server errors that
  match no field render in one `mb-callout` under the header. The document editor keeps
  its own store for the sake of undo, but reads the same way.
- **Side lists** - `*SideList.vue`, an `EntityPanel` with `:query` (its load error and retry show by default)
  and `create-label` plus `create-to` or `@create` for the compact `+` button. A route
  names its list with `meta.panel`; `SIDE_PANELS` (`components/layout/side-panels.ts`)
  holds each one's label, icon, component and props for the shell column, the drawer and
  the top bar toggle. `meta.section` names the sidebar entry a route belongs to.
- **Master-detail** - `MasterDetail`: the list at `18rem`, the detail keyed by id, an
  `EmptyState` when nothing is chosen; its "New" sits in the header above it.
- **Settings tabs** - a tab body is `*Settings.vue`: a `Panel` with `size="lg"`,
  `:card="false"`, a description and its "New" in the actions. Sections inside it are
  `Panel` cards with `heading="h3"` at the base size, named `*Section.vue` when they are
  their own file; so are the sections of a page's inspector aside. The last section of a
  record's settings is its deletion.
- **Dialogs with a form** - `FormDialog`: a real `<form>`, so Enter submits; Cancel,
  a `SaveButton` with the busy label, `danger` for a destructive submit. `@submit` returns
  the write's promise; resolving `true` closes it.

## Actions

- **New** - on a list or landing page, `mb-btn-primary` in the `PageHeader` actions, bound
  to `n`, its `title` from `shortcutHint('n', 'New menu')`. Side lists keep the compact
  `+` (`EntityPanel`'s `create-label`).
- **Creating** - small records (a name or two: menu, workflow, space, user, role) are
  created in a `FormDialog` opened from the `+` and the page's button, which navigates to
  the editor on success. Editor-sized records (content type, databag type, template,
  document) open their editor on a `/new` route. `?new=space` from the shell's empty
  state is the one deep link.
- **Destructive** - `mb-btn-ghost-danger` with a trash (or matching) icon and a label,
  always through `confirmAndRun` with `danger: true`. Dense table rows may drop the label
  and keep an `aria-label`. The one exception is removing a part of an unsaved draft (a
  block, a menu entry, a field of a content type): it runs at once, since undo or leaving
  without saving brings it back; its icon button still uses `mb-btn-ghost-danger`.
- **Row actions** - icon buttons that appear on a row's hover (a tree's delete, a
  notification's mark-read) carry `mb-row-action` inside a `group` row. They show on hover
  or focus where a mouse and a wide screen exist, and always on touch and narrow screens.
  Drop the class while the action is busy or its menu is open. No hand-built
  `opacity-0 group-hover:` or `hidden group-hover:` reveal.
- **Writes** - every write runs through `runWrite(fn, { success, error, busy })` or
  `confirmAndRun(options, fn, feedback)` from `lib/write`: they toast the outcome, hold the
  busy flag and fill the error ref. No `try` / `catch` around a write in a component, and
  `toast.caught` stays inside `lib/`. Editor saves use the form's `submit`, which marks
  field errors.
- **Permissions and space** - `useCan('menu:write')` (optionally with a type id) for UI
  checks; `requireSpace()` inside a write for the current space id.
- **Shortcut hints** - `shortcutHint(keys)` writes keys for the platform (`Cmd` / `Ctrl`,
  `Option` / `Alt`); no hand-written `(N)` or `Cmd+Enter`.

## Data

- Components never import the client (`@manablox/admin-sdk/lib/api`, or `api` from the SDK entry; Biome enforces it). Reads are `use*` composables
  and writes are writer objects in the feature's `queries.ts`, each followed by the
  invalidation it implies.
- Every query key is built by `keys` in `lib/queries.ts`, with a params object as an
  object in the key (never `JSON.stringify`). Space-scoped reads go through
  `useSpaceQuery`; hooks take `spaceId` as an optional last argument and default to the
  current space. Pages and feature roots read the space store; leaf components take
  `spaceId` as a prop when that is all they need from the space store, and pass it to
  their queries, writes and child pickers. A component that also needs the locale,
  permissions, content types or the space's locales reads the store (`ContentTree`,
  `ContentPicker`, `FieldControl`, the trigger forms through `useScopeOptions`), as do
  shared composables such as `useCan` and `useFeature`.
- Domain types come from `lib/api-types.ts`, inferred from the router. Constants shared
  with the server come from `@manablox/core`. A `.vue` file exports types only;
  shared values live in `lib/` or the feature's model.
- **Field inputs** read nothing from the app: `useFieldContext()` hands them the space,
  the locale, the error at their path and the content model. Anything providing a
  `FieldContext` can render them.
- **Emit new values** - the document draft tracks two levels (`useDraftForm({ shallow: 2
  })`), so a field input or list control never changes its `modelValue` in place: it
  emits a new array or object (`[...list, item]`, `{ ...value, key }`). Mutating in place
  would leave the document clean and lose the edit. `test/field-inputs-emit.test.ts`
  drives every registered field input with a frozen value and fails on an in-place write;
  a new input type needs a fixture there.

## Writing for the admin

- Sentence case everywhere: titles, labels, buttons, hints. Badges are the exception and
  are lower case (`unsaved`, `read only`, `live`, `draft`, `new`, `on`, `off`, `code`,
  `built in`, `changed`) - `StatusBadge` spells them.
- Button labels are verbs: `Save`, `Create menu`, `Delete asset`. The in-flight label is
  the verb with an ellipsis: `Saving...`, `Creating...`. `SaveButton` does this.
- Counts always go through `plural()`; dates through `formatDate` / `formatDateTime` /
  `relativeTime`; sizes through `formatBytes` (`lib/format.ts`).
- A save with field errors reports one sentence, `NOT_SAVED`, and marks the fields; any
  other failure reports the server's message through `runWrite`. A success names what
  happened: `Saved "Main navigation"`, `Deleted hero.jpg`.
- Colour is semantic: `danger-*` and `warn-*` are the only reds and ambers; `ok-*` the only
  green; everything else is `brand`, `surface`, `cyan` or `pink`. No stock Tailwind hue.

## Shortcuts

The same on every page that offers them: `Cmd+S` saves, `Cmd+Z` / `Shift+Cmd+Z` undo and redo in the
document editor, `Cmd+A` selects everything in a multi-select list, `Esc` clears a selection
or closes the topmost dialog or popover. Tab lists take the arrow keys, Home and End.
