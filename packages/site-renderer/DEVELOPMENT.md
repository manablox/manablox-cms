# `@manablox/site-renderer`: development notes

How the renderer is put together. The user-facing summary is in `README.md`.

## Rendering

- `src/page.ts`: `renderSitePage` wraps `renderBody` in `createSSRApp` + `renderToString`
  (no hydration) and writes the head around it.
- `src/body.ts`: `renderBody` picks what to draw: layout + page, or with a canvas `focus`
  a block alone (sample values from `input.document.fields`), a menu alone, or the theme
  style guide. `DesignRenderer` is the same as a component, used by the canvas.
- `src/renderer.ts`: `renderNode` does what every element shares (visibility, the class
  contract from `@manablox/site` `classes.ts`, canvas markers) and dispatches to one render
  function per element kind in `src/elements/*`.
- `src/bindings.ts`: field paths resolve against a `DataScope` (document, block, repeater
  item). Bindings name field ids; values are read by field name, falling back to the id.
  Repeats push a `RepeatFrame` keyed by their bound path, which `<path>.<sub>` and
  `<path>.$item` read.
- Canvas markers: `data-mb-node="<kind>:<key>:<nodeId>"` and `data-mb-el` on every node of
  the focused design (every node without a focus). The live-preview markers
  (`data-manablox-field`, `data-manablox-list`) only without a focus, i.e. in content mode.
  Their paths follow the content visual editor: `[list, index, field]`.

## Browser bundles

Islands (`src/islands/*.ts`, plain DOM, no imports from the rest of the package) and the
canvas (`src/canvas/entry.ts`, Vue included) are bundled with rolldown by
`src/client-build.ts`:

- `pnpm build` runs tsdown, then `scripts/build-client.ts`, which writes
  `dist/client/<fileName>` and `dist/client/manifest.json`.
- A dynamic import becomes a chunk beside its bundle (`chunks` in the manifest), served
  below `/_site/` like the bundles. The canvas has one: the inline rich text editor, which
  `@manablox/live-preview` loads when an edit starts.
- From source (the workspace), `loadClientAssets()` builds them in memory on first use, so
  the dev server needs no build step. rolldown is a dev dependency for that reason.

Adding an island: a file in `src/islands/`, its name in `ISLAND_NAMES`, and
`ctx.islands.add(name)` in the element that needs it.

## Forms

The form element posts `application/x-www-form-urlencoded` to
`<formActionBase>/<designKind>/<designKey>/<nodeId>` with the fields by name plus
`FORM_FIELDS`: `_mb_ts` (render time), `_mb_hp` (honeypot, must be empty), `_mb_locale`,
`_mb_page` (path to return to), `_mb_consent`, and from the island `_mb_elapsed`
(milliseconds between load and submit; prefer it over `_mb_ts`, which is old on cached
pages). The island sends `Accept: application/json` and expects
`{ ok, message?, redirect?, errors?: { [fieldName]: message } }`; without the island the
endpoint redirects back and the page is rendered with `formResult`.

## Fonts

`fonts/` holds the `BUNDLED_FONTS` files at their `bundledPath`, each family with its
licence. `pnpm fonts` downloads them from pinned upstream revisions and checks them against
`fonts/SHA256SUMS.json`; `node scripts/fetch-fonts.mjs --check` only checks. The files are
the upstream variable fonts, not subset.
