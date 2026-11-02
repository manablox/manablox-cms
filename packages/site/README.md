# `@manablox/site`

The building blocks of a designed Manablox site: what a design looks like, how it is
checked, and how it becomes CSS. It is the library of the website plugin
(`@manablox/plugin-website`): the plugin's admin screens use it to edit designs, the site
renderer uses it to draw pages, and the plugin's server part uses it to check what gets
saved.

It runs anywhere: in the browser and in Node. It has no Vue and no Node-only code.

## What is a design?

A space that uses the visual designer stores a few kinds of design documents:

| Kind | What it holds |
| --- | --- |
| `theme` | Colors, fonts, the type scale, spacing, corner radius, shadows, container widths and the look of links, buttons and inputs |
| `block` | How one block type looks, as a tree of elements. It can have several named variants |
| `page` | How the pages of one content type look, and which layout they use |
| `layout` | The frame around pages: header, footer, menus. It holds exactly one `slot` where the page goes |
| `menu` | How a menu looks: a preset, styles per level, and what happens on small screens |
| `site` | Site name, logo, favicon, page title pattern, SEO defaults, robots, custom CSS and code snippets |

Block, page and layout designs are trees of elements (`DesignNode`). Each element has an
`id`, a kind (`el`, for example `heading`, `image` or `stack`), and optionally a binding to
a field (`bind: { field: '<fieldId>' }`), element options (`props`) and styles (`style`).

## Install

```sh
npm install @manablox/site
```

## Usage

### Start from generated designs

```ts
import { defaultTheme, generateBlockDesign, generateLayout, generatePageDesign } from '@manablox/site';

const theme = defaultTheme();
const teaser = generateBlockDesign(teaserType); // one element per field
const article = generatePageDesign(articleType); // title first, then every field
const layout = generateLayout({ name: 'My site' }, [{ machineName: 'main' }, { machineName: 'footer' }]);
```

`teaserType` and `articleType` are content type definitions from `@manablox/core`. How fields
turn into elements:

| Field type | Element |
| --- | --- |
| Text (`string`) | The first one becomes a `heading`, the others `text` |
| Rich text | `richtext` |
| Number, yes/no, date, select, user | `text`, formatted |
| Asset | `image`, `video` or a download `link`, depending on the accepted file types |
| Link | The first one becomes a `button`, the others `link` |
| Content reference | A `link` to the referenced page |
| Blocks, block, content template | `blocks`, `block`, `template` |
| Repeater | `repeat` with the item's fields inside |
| Lists (multiple values) | `repeat` around one element per entry |

### Check a design

```ts
import { validateSiteDesign } from '@manablox/site';

const result = validateSiteDesign('block', teaser);
if (!result.ok) {
  for (const issue of result.issues) console.log(issue.path, issue.message);
}
```

It checks, among other things, that element ids are unique, that styles only use allowed
properties and theme tokens, that chrome elements (`menu`, `logo`, `slot`, ...) are only
used in layouts, that a layout has exactly one `slot`, and that a design is not too deep
or too large. `validateInstanceDesign(value)` checks the design of a single block (its
variant and style overrides, stored at `ext.website`), `validateInstanceStyle(value)` just
the style overrides. Frontends get the block design types (`BlockInstanceDesign`,
`BlockInstanceStyle`, `DesignedBlock`) and `hasBlockDesign` from `@manablox/site/sdk`.

### Turn designs into CSS

```ts
import { classFor, compileSiteCss } from '@manablox/site';

const css = compileSiteCss({
  theme,
  designs: [{ kind: 'block', key: teaserType.id, data: teaser }],
  customCss: '.hero { letter-spacing: 0.02em; }',
  fontUrl: (file) => (file.assetId ? `/media/${file.assetId}` : null),
  assetUrl: (assetId) => `/media/${assetId}`,
});

// The class the renderer puts on a styled element:
classFor('block', teaserType.id, 'root');
```

The same input always gives the same CSS. Theme values become CSS custom properties
(`--mb-color-primary`, `--mb-space-4`, ...). Each styled element gets its own class, with
tablet (up to 1023px) and mobile (up to 639px) rules and hover, focus and active states.
Your custom CSS goes last, so it wins over everything else.

### Styles use tokens

Styles refer to the theme by name, so changing the theme restyles the whole site:

```ts
const style = {
  base: { padding: 'space:6', background: 'color:surface', radius: 'radius:md' },
  mobile: { padding: 'space:4' },
  hover: { shadow: 'shadow:md' },
};
```

Token names look like `color:primary`, `color:primary/50` (50% opacity), `space:4`,
`radius:md`, `shadow:lg`, `type:xl`, `font:heading` and `container:lg`. Only sizes such as
`width` or `min-height` take plain values with a unit, like `50%` or `20rem`.

## Other functions

- `defaultTheme()`, `defaultSiteSettings()`, `starterThemes()`: ready-made starting points. Twelve starter themes in three categories (`THEME_CATEGORIES`: professional, creative, personal), each with `main` and `footer` menu designs.
- `generateMenuDesign(menu)`, `generateFormNodes(dataType)`: a menu design, or a form for a data type.
- `generateBlockPreset(type, preset, { taken })`: a block variant laid out as `imageLeft`, `card`, `hero` or `centered` (see `BLOCK_PRESETS`), showing every field. Pass the ids the design already uses as `taken`, because all variants of a block share one set of ids.
- `findUnplacedFields(design, type)`: fields no element shows yet.
- `findBrokenBindings(design, type)`: elements bound to fields that no longer exist.
- `findNode`, `insertNode`, `moveNode`, `removeNode`, `duplicateNode`, `updateNode`, `walkNodes`, `newNodeId`: edit element trees without changing the original.
- `canPlace(el, designKind, ancestors)`, `canContain(parent, child)`: where an element may go.
- `instanceClass(style)`, `elementClass(el)`, `menuClass(key)`, `MENU_CLASSES`: class names shared with the renderer.
- `BUNDLED_FONTS`: the open fonts the site renderer ships.
- `validateThemeBundle(value)`, `starterBundle(theme)`, `designFieldPaths(fields)`, `remapDesignFields(kind, design, from, to)`: theme files (`format: 'manablox-theme'`), the file a starter theme would export, and moving a design to a content type whose field ids differ by matching field names.
- `siteHasCode(site)`, `withoutSiteCode(site)`: whether site settings carry custom CSS or head and body code, and a copy without it.
- `WEBSITE_CHANNEL`, `WebsiteCanvasMessages`: the live-preview plugin channel (`website`) between the designer in the admin and the design canvas, and the messages each side sends.

## License

MIT, see `LICENSE`. It is part of the website plugin (`@manablox/plugin-website`).
