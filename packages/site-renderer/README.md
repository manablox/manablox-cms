# `@manablox/site-renderer`

Turns a designed Manablox site into HTML. It takes one page's worth of data (the document,
its designs, the theme, the menus, the site settings) and returns a complete HTML document.
The website plugin (`@manablox/plugin-website`) uses it to serve designed sites, and the admin's design canvas
uses it to show designs while you edit them, so both draw exactly the same markup.

Pages are rendered on the server with Vue. The browser gets plain HTML and CSS; only a few
tiny scripts ("islands") are added, and only on pages that need them: one for menus (the
mobile menu button and keyboard support) and one for forms (sending without a page reload).

The designs themselves, and the stylesheet, come from `@manablox/site`.

## Install

```sh
npm install @manablox/site-renderer
```

## Render a page

```ts
import { renderSitePage } from '@manablox/site-renderer';

const { html, status } = await renderSitePage(input);
```

`input` is a `SiteRenderInput` from `@manablox/site`: everything the page needs, already
loaded. The most important parts:

| Field | What it is |
| --- | --- |
| `mode` | `live` for normal visitors, `share` for preview links, `canvas` for the design editor |
| `document` | The page's document with its fields by name, as the delivery API returns them. `null` renders a "Page not found" page |
| `page`, `layout` | The page design and the layout around it |
| `blockDesigns` | Designs by block type id. A block type without one uses a design generated from its fields |
| `menus`, `menuDesigns` | Menus by machine name with their items, and menu designs by key |
| `contentTypes` | Content types by id, so the renderer can find fields by id |
| `assets` | Assets the designs use directly (logo, favicon, share image, images picked in a design) |
| `cssHref` | Address of the site stylesheet made with `compileSiteCss` from `@manablox/site` |
| `formActionBase` | Where forms send their data |

### Options

The second argument is optional:

| Option | Meaning |
| --- | --- |
| `islandSrc` | Script address per island, for example `{ menu: '/_site/islands/menu.3f2a1c9b0d.js' }`. See "Serve the scripts" below |
| `imageWidths` | Width of each image preset, for `srcset`. Default: `thumb` 320, `card` 640, `hero` 1920 |
| `fontUrl` | Address of a font file. Use the same function you pass to `compileSiteCss`, so the preloads match |
| `breadcrumbs` | The trail for the breadcrumbs element, from the home page down, without the page itself. Without it the renderer follows the current menu path |
| `formResult` | Shows a form's success or error message, after a form was sent without JavaScript |
| `now` | Time written into forms, in milliseconds. Defaults to the current time |
| `focus` | Canvas only: the design being edited |

### What you get back

| Field | Meaning |
| --- | --- |
| `html` | The whole document, from `<!doctype html>` to `</html>` |
| `status` | The HTTP status to send, from `input.status` |
| `head` | The page title and description |
| `islands` | The scripts the page loads |
| `instanceStyles` | Style overrides of blocks on this page. The stylesheet needs a rule for each (`instanceStyles` of `compileSiteCss`) |

What the head contains: the title from the site's title pattern, the description, the
canonical address and language alternates (live pages), Open Graph and Twitter tags, the
favicon, preloads for the body and heading fonts, the stylesheet, and the site's own head
code. Share links and sites that should not be indexed get `noindex`; share links also show
a small "Preview" badge.

## Serve the scripts and fonts

The island scripts, the canvas app and the bundled fonts are files your server hands out.
The helpers for that run in Node only:

```ts
import { bundledFontFile, clientAssetUrls, findClientAsset, loadClientAssets } from '@manablox/site-renderer/assets';

const assets = await loadClientAssets();
const { islandSrc, canvasSrc } = clientAssetUrls(assets); // below /_site/

// GET /_site/islands/menu.<hash>.js and /_site/canvas.<hash>.js
const file = findClientAsset(assets, 'islands/menu.3f2a1c9b0d.js'); // { fileName, hash, code } or null

// GET /_site/fonts/inter/Inter-Variable.woff2
const path = bundledFontFile('inter/Inter-Variable.woff2'); // a file path, or null for unknown names
```

File names contain a hash of their content, so they can be cached forever.

## The design canvas

The admin shows designs inside a frame that points at your site process. Serve this page
at `/_manablox/canvas`:

```ts
import { renderCanvasPage } from '@manablox/site-renderer';

const html = renderCanvasPage({ scriptSrc: canvasSrc, editorOrigin: 'https://admin.example.com' });
```

Send it with `Content-Security-Policy: frame-ancestors https://admin.example.com`. The page
loads nothing by itself; the admin sends it what to draw over the live-preview plugin
channel `website` (`WebsiteCanvasMessages` in `@manablox/site`). If you build your own canvas page,
`@manablox/site-renderer/canvas` exports `mountCanvas(element, { editorOrigin })`.

To drag elements from a palette into the canvas, set two drag data types:
`application/x-manablox-element` with the element kind, and
`application/x-manablox-element-<kind in lower case>` (`paletteKindType(kind)`), because the
canvas can only see the types while dragging.

## Elements

Every element of `@manablox/site` is supported. A few notes:

- **Embeds** accept YouTube, Vimeo, Google Maps, Spotify and SoundCloud addresses. The frame address is rebuilt from the video or map id, so nothing else from the address reaches the page.
- **Icons** come from a small built-in set drawn in the text color (`ICON_NAMES` lists them).
- **Rich text** is converted with the same safe converter as the delivery SDK.
- **Forms** send to `<formActionBase>/<design kind>/<design key>/<element id>` and carry a hidden trap field and the time the page was made, to keep out spam bots.

## Fonts

The bundled fonts are Inter, Source Serif 4, Space Grotesk, Fraunces, Lora, Outfit, DM Sans, Bricolage Grotesque, Plus Jakarta Sans and JetBrains Mono, all under the
SIL Open Font License. The licence of each is next to its files in `fonts/`.

## License

MIT, see `LICENSE`. It is part of the website plugin (`@manablox/plugin-website`).
