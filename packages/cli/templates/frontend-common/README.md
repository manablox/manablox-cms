# __NAME__

A Manablox frontend on **__FRAMEWORK_LABEL__**, scaffolded with
`manablox frontend`. It reads from the delivery API at <__MANABLOX_URL__>: no API key, no
credential, nothing to leak.

## Run it

```sh
pnpm install
__DEV__          # http://localhost:__PORT__
__BUILD__
__START__
```

## Configuration

Every value lives in `.env`, and `.env.example` beside it lists them.

| | |
| --- | --- |
| `__ENV_PREFIX__MANABLOX_URL` | The delivery API, default `__MANABLOX_URL__` |
| `__ENV_PREFIX__MANABLOX_ADMIN_ORIGIN` | The admin's origin, for the preview channel |
| `__ENV_PREFIX__MANABLOX_SPACE_ID` | Only needed against a management instance |

{{#if plain}}
Vite inlines these into the bundle at build time, so they have to be reachable from a
browser and a change to them needs a rebuild.
{{#else}}
They are read from `process.env` on the server, at start-up, so one build runs against
any instance.
{{/if}}

## What is where

{{#if plain}}
- `src/main.ts` - the router, the client, and what each route renders.
- `src/pages.ts` - a document, its blocks and the menu, as DOM.
- `src/blocks/` - one renderer per block type, found by the type in `index.ts`.
- `src/content/` - a document, through its content type's renderer or the generic one.
- `src/preview.ts` - the canvas the visual editor drives.
{{/if}}
{{#if astro}}
- `src/pages/[...slug].astro` - one request resolves a URL path to a document.
- `src/pages/preview.astro` - the canvas the visual editor drives, in the browser.
- `src/components/blocks/` - one component per block type, found by the type in `index.ts`.
- `src/components/content/` - a component per content type; any other renders generically.
- `src/lib/manablox.ts` - the client, one per process.
{{/if}}
{{#if reactSsr}}
- `server.js` - Express with Vite in development, the built bundles in production.
- `src/entry-server.tsx` - loads the data, then renders the app to HTML.
- `src/entry-client.tsx` - hydrates it and takes over navigation.
- `src/lib/load.ts` - the one loader both sides call.
- `src/components/blocks/` - one component per block type, found by the type in `index.ts`.
- `src/components/content/` - a component per content type; any other renders generically.
- `src/pages/Preview.tsx` - the canvas the visual editor drives.
{{/if}}
{{#if vueSsr}}
- `server.js` - Express with Vite in development, the built bundles in production.
- `src/entry-server.ts`, `src/entry-client.ts` - render on the server, hydrate here.
- `src/composables/useLoad.ts` - fetch on the server, reuse it in the browser.
- `src/components/blocks/` - one component per block type, found by the type in `index.ts`.
- `src/components/content/` - a component per content type; any other renders generically.
- `src/pages/Preview.vue` - the canvas the visual editor drives.
{{/if}}

{{#if model}}
## Written from the content model

A component for each of these types, one element per field, was written from the space's
content model. They are a starting point to edit, not generated code to keep in step: a
field added in the admin later needs a line in its component, and a new type a component
and a line in the registry beside it. `fields.ts` holds the helpers that read a value
into something to show, and the pages name every relation field in `expand` so it
arrives as an object rather than an id.

__MODEL_TYPES__
{{#else}}
The one block that ships is `teaser`, an example. A block type of your own gets a
component in the blocks folder and a line in its `index.ts`; a content type that should
not render as the generic article gets one in the content folder.
{{/if}}

## Typed content

```sh
pnpm types      # writes src/manablox.d.ts from __MANABLOX_URL__/v1/types
```

Generated from the space's content model. Typing the `byPermalink` call with the
generated `Page` interface turns a field renamed in the admin into a compile error after
the next `pnpm types`, rather than `undefined` in production. Re-run it whenever the
model changes.

## The visual editor

The admin's **Visual** button loads `<this site>/preview` in a frame and pushes the
document being edited into it on every keystroke, unsaved. The route needs no API key: the
editor sends the document over the channel rather than the page fetching a draft. Set the
frontend URL on the space in the admin{{#if ssr}}, and keep `MANABLOX_ADMIN_ORIGIN` pointing at that admin{{/if}}.

The origin check in `connectPreview` is not optional. Without it any page could drive the
preview.
