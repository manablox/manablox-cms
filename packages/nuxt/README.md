# `@manablox/nuxt`

Show your Manablox content in a Nuxt site, with live preview from the admin built in.

The module sets up the `@manablox/public-sdk` client for you, adds composables to load
content and components to render blocks, and turns a `/preview` page into the canvas of
the visual editor.

## Install

```sh
npm install @manablox/nuxt
```

## Usage

With a project made by `manablox create` running locally, the defaults already point at
it: content comes from the public API on `http://localhost:3100` and the preview accepts
the admin on `http://localhost:3000`. Otherwise set the addresses:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@manablox/nuxt'],
  manablox: {
    url: 'https://content.example.com',
    preview: { editorOrigin: 'https://cms.example.com' },
  },
});
```

```vue
<!-- pages/[...slug].vue -->
<script setup lang="ts">
const { data: page } = await useManabloxPage('... on Page { components }');
</script>

<template>
  <h1>{{ page?.title }}</h1>
  <ManabloxBlocks :blocks="page?.components" />
</template>
```

`<ManabloxBlocks>` renders each block with a component named after its type: a block of
type `teaser` renders your `<BlockTeaser>` component.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `url` | `$MANABLOX_URL`, else `http://localhost:3100` | The address of your public delivery API |
| `spaceId` | `$MANABLOX_SPACE_ID`, else none | Only needed when you read from a management API, which returns nothing without it. A public API ignores it |
| `locale` | `en` | The language to read |
| `transport` | `graphql` | `graphql` or `rest`. Only a public API serves `rest` |
| `apiKey` | none | An API key for server-side code you write yourself. It is never sent to the browser |
| `cache` | `{ ttl: 1000, max: 100 }` | The client's request cache: `ttl` in milliseconds, `max` entries. `false` turns it off; identical requests running at the same time are still sent once |
| `preview.enabled` | `true` | Set `false` and `<ManabloxPreview>` no longer connects to the editor |
| `preview.route` | `/preview` | Only recorded in the runtime config. The admin always opens the space's Frontend URL plus `/preview`, so keep your preview page there |
| `preview.editorOrigin` | `$MANABLOX_ADMIN_ORIGIN`, else `http://localhost:3000` | The address of the admin. The preview only accepts messages from there |

The environment variables are read when Nuxt builds or starts in development. To change
an address on a built site, set `NUXT_PUBLIC_MANABLOX_URL`,
`NUXT_PUBLIC_MANABLOX_SPACE_ID` or `NUXT_PUBLIC_MANABLOX_PREVIEW_EDITOR_ORIGIN` when you
start it.

## Composables

- `useManablox()`: the SDK client, already configured. Every call in one app returns the same client, and on the server each request gets its own, so its cache is never shared between visitors.
- `useManabloxPage(selection)` or `useManabloxPage({ selection, expand })`: loads the document for the current URL. Works with server-side rendering. `selection` picks the GraphQL fields and is ignored on `rest`. `expand` lists the image and relation fields to deliver whole on `rest`, for example `['hero', 'author']`; without it they arrive as ids. GraphQL resolves them anyway.
- `useManabloxPreviewState()`: the draft the editor is changing, set by `<ManabloxPreview>` while the page is open in the admin, else `null`. Read it anywhere, for example in a layout.

## Components

- `<ManabloxBlocks :blocks="...">`: renders a blocks field on its grid. Props: `field`, `prefix` (default `Block`), `grid`, `gap`.
- `<ManabloxPreview>`: put it on your `/preview` page. Its slot receives the draft `document` and its `fields`.

Requires Nuxt 4 or newer.
