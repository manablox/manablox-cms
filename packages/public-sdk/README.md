# `@manablox/public-sdk`

Read the content of your Manablox CMS from any website or app.

The SDK talks to the public API of your CMS for you. You ask for a page by its URL, a
menu by its name or a list of blog posts, and get back plain JavaScript objects. It works
in the browser, in Node and on edge servers, and it has no dependencies.

## Install

```sh
npm install @manablox/public-sdk
```

## Usage

```ts
import { createClient, richTextToHtml } from '@manablox/public-sdk';

const cms = createClient({ url: 'https://api.example.com' });

const page = await cms.byPermalink('/about');   // the page at /about, or null
const menu = await cms.menu('main');            // the menu called "main"
const posts = await cms.list({ type: 'post', limit: 10 });

console.log(page?.title, richTextToHtml(page?.body));
```

Each field of a document is available directly (`page.summary`) and under `fields`
(`page.fields.summary`).

## Creating a client

`createClient(options)` returns a client. Options:

| Option | Meaning |
| --- | --- |
| `url` | The address of your CMS API. Required |
| `transport` | `'graphql'` (default) or `'rest'`. Both give the same results |
| `locale` | The language to read, e.g. `'de'` |
| `spaceId` | Only needed when you read from a management API instead of the public one |
| `environment` | With `spaceId`: the environment to read, e.g. `'staging'`. Production when left out. A public API reads the environment of its address instead |
| `cache` | `{ ttl, max }` to keep answers in memory for `ttl` milliseconds, or `false` |
| `timeout` | How long one request may take, in milliseconds |
| `retry` | `{ attempts, baseDelay, maxDelay }` to retry failed requests |
| `headers` | Extra HTTP headers for every request |
| `fetch` | Your own `fetch` function |

## Client methods

| Method | Returns |
| --- | --- |
| `byPermalink(path)` | The document that lives at a URL path, or `null` |
| `get(id)` | One document by its id, or `null` |
| `list({ type, parentId, search, limit, offset })` | A page of documents |
| `menu(name)` | A menu with nested entries (`label`, `href`, `children`), or `null` |
| `redirects()` | Every redirect of the locale: `fromPath`, `toPath`, `status` (301 or 302), `locale` and `contentId`. Paths have no locale prefix |
| `asset(id)` | An image or file, or `null` |
| `types()` | The content types of the space |
| `query(graphql, variables)` | Runs your own GraphQL query (GraphQL transport only) |
| `withLocale(locale)` | A copy of the client that reads another language |
| `clearCache()` | Forgets everything cached |

Every method takes optional request options as its last argument: `locale`, `expand`
(linked documents to include), `selection` (extra GraphQL fields), `signal` (to cancel)
and `fresh` (skip the cache once).

## Helpers

- `richTextToHtml(value)`, `richTextToText(value)`: turn a rich text field into HTML or plain text. `isRichTextEmpty(value)` checks if it has any text.
- `assetUrl(asset, { preset })`: the URL of an image in a size your CMS defines, like `thumb`. `assetSrcSet(asset, presets)` builds a `srcset`. `isImage(asset)` checks the file type.
- `blocksOf(field)`: the blocks of a blocks field, as an array.
- `blocksGridStyle(field)`, `blockLayoutStyle(block)`, `BLOCK_GRID_CSS`: CSS to lay out blocks on the grid the editor chose, for desktop, tablet and mobile.
- `normaliseFields(fields, options?)`: brings fields from the live preview into the same shape as the API returns. `options.blockExtensions` names block keys that are plugin data rather than fields on GraphQL blocks (none by default; `['design']` with the website plugin); the client takes the same `blockExtensions` option.
- `pascalName(name, prefix)`: the component or type name for a content type, like `hero.banner` to `HeroBanner`. `isIdentifier(name)` checks if a field name can be written as `block.name`.

## Errors

Failed requests throw an error you can check with `instanceof`: `ManabloxHttpError`
(the server answered with an error status), `ManabloxGraphQLError`,
`ManabloxTimeoutError` and `ManabloxAbortError`.

- `ManabloxHttpError`: `status`, `isNotFound`, `isRateLimited`, and from the server's `{ error }` body `key` (for example `content.notFound`), `details` and the whole body as `error`.
- `ManabloxGraphQLError`: `errors` as returned, `code`, `key` from the first error's `extensions.key`, and `status`, the HTTP status (200 for field errors, 4xx or 5xx when the server refused the whole request, such as a query past the depth limit).

## Preview of drafts

```ts
import { createPreviewClient } from '@manablox/public-sdk/preview';

const preview = createPreviewClient({ url: 'https://cms.example.com', apiKey: process.env.MANABLOX_KEY });
```

Reads unpublished drafts. It needs an API key, so use it only in server code, never in
the browser.

## TypeScript types for your content

```sh
npx manablox-sdk types --url https://api.example.com --out src/manablox.d.ts
```

Writes one TypeScript interface per content type of your space.

| Option | Meaning |
| --- | --- |
| `--url` | The public API of your CMS. Defaults to `$MANABLOX_URL` |
| `--out` | The file to write. Prints to the terminal when left out |
| `--prefix` | Text put in front of every interface name, to avoid name clashes |
