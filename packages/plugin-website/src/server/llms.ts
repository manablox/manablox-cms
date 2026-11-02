import { type PluginLlmsContext, SPACE_BLOCK_IDS, SPACE_TEMPLATE_IDS } from '@manablox/core';
import {
  BUTTON_VARIANTS,
  COLOR_ROLES,
  DESIGN_PRESETS,
  designPresetBundle,
  ELEMENTS,
  EMBED_PROVIDERS,
  STYLE_PROP_NAMES,
  starterThemes,
  THEME_CATEGORIES,
  TYPE_STEPS,
} from '@manablox/site';
import { ICON_NAMES } from '@manablox/site-renderer';

type Call = PluginLlmsContext['call'];

const list = (values: readonly string[]) => values.map((value) => `\`${value}\``).join(', ');

/** An example type and the preset designs for it, to show real design JSON. */
function examples() {
  const hero = {
    name: 'hero',
    kind: 'block',
    fields: [
      { name: 'headline', type: 'string' },
      { name: 'subline', type: 'string' },
      { name: 'image', type: 'asset' },
    ],
  };
  const page = {
    name: 'page',
    kind: 'content',
    fields: [
      { name: 'summary', type: 'string' },
      { name: 'components', type: 'blocks' },
    ],
  };
  const bundle = designPresetBundle('atlas', { types: [hero, page], locale: 'en' });
  const find = (kind: string, key: string) =>
    bundle?.designs.find((design) => design.kind === kind && design.key === key)?.data;
  return { block: find('block', 'hero'), layout: find('layout', 'default'), bundle };
}

/** The website plugin's section of the LLM guide. */
export function websiteLlms(context: PluginLlmsContext): string {
  return designGuide(context.call, context.complete).join('\n');
}

/**
 * The visual design section of the LLM guide: how a designed site is built from design
 * documents, and how to make one look good.
 */
function designGuide(call: Call, complete: boolean): string[] {
  const themes = starterThemes();
  const byCategory = THEME_CATEGORIES.map(
    (category) =>
      `${category.label}: ${list(themes.filter((theme) => theme.category === category.id).map((theme) => theme.id))} themes, ${list(DESIGN_PRESETS.filter((preset) => preset.category === category.id).map((preset) => preset.id))} designs`,
  );
  const elements = Object.entries(ELEMENTS);
  const lines = [
    '## Visual design (designed sites)',
    '',
    'A space is either a **designed site**, rendered by the Manablox site process from design documents, or content for an own frontend. `plugins.website.settings.set` `{spaceId, mode: "designed"}` switches it; `plugins.website.domains.create` `{spaceId, hostname, isPrimary: true}` gives it the host it answers on.',
    '',
    'Design documents, each a draft and a published copy, by `kind` and `key`:',
    '',
    '- `theme` (key `default`): design tokens: colors, fonts, type scale, spacing, radius, shadows, container widths, and base styles of plain elements (links, buttons, inputs, rich text).',
    '- `layout` (key `default`, or any name): the page frame, header and footer, with one `slot` element where the page goes. `site.layouts` assigns a layout per content type id.',
    '- `menu` (key: a menu machine name, or any name a `menu` element picks with `design`): how a menu looks, its levels and mobile behaviour.',
    '- `block` (key: the block type id): how a block type looks, as one or more variants.',
    '- `page` (key: the document type id): how a document of that type is laid out; a `blocks` element shows its block field.',
    '- `site` (key `default`): site name, logo, favicon, title pattern, meta, robots and layout assignments.',
    '',
    'Types without a stored design use a generated one that shows every field. Designs are saved as drafts with `plugins.website.design.saveDraft` `{spaceId, kind, key, draft, expectedVersion}` (0 for a design not stored yet; `plugins.website.design.get` returns the current version) and go live with `plugins.website.design.publishAll` `{spaceId}`. Every draft is validated; a failure lists each problem with its path.',
    '',
    '### A complete design in two calls',
    '',
    `The quickest good-looking site: apply a starter theme together with a design preset, then publish. A preset writes the \`default\` layout, the \`main\` and \`footer\` menu designs and designs for the block and document types it knows (those of the website types ${list(SPACE_TEMPLATE_IDS)} and the block catalog ${list(SPACE_BLOCK_IDS)}; other document types get a page frame around their fields). Themes set colors and fonts; presets set structure, so any preset works with any theme. ${byCategory.join('; ')}.`,
    '',
    call('plugins/website/design/applyStarter', {
      spaceId: '<space id>',
      id: 'builtin:studio',
      preset: 'spotlight',
      replace: true,
    }),
    '',
    'Then `plugins.website.design.publishAll` `{spaceId}`. `plugins.website.design.starterThemes` lists the themes a space can use, code themes included. `plugins.website.design.exportTheme` `{spaceId, variant: "draft"}` returns every design of a space as one bundle, a good starting point to edit; `plugins.website.design.importTheme` `{spaceId, bundle, replace}` writes a bundle back as drafts.',
    '',
    '### Design nodes',
    '',
    'Layouts, pages and block variants are trees of nodes: `{"id", "el", "bind"?, "props"?, "style"?, "children"?, "visibility"?}`. `id` is unique within the design (a letter, then letters, digits, `-` or `_`, at most 40).',
    '',
    `- Structure: \`section\` (a full-width band whose children sit in a centered container; \`props.container\` picks a width), \`stack\` (flex column, \`direction: "row"\` for a row), \`grid\` (\`columns\`), \`box\`, \`spacer\`, \`divider\`. \`props.as\` sets the HTML tag (\`header\`, \`footer\`, \`main\`, \`article\`, \`figure\`, ...).`,
    `- Content: \`heading\` (\`level\` 1-6), \`text\` (\`as\`: p, span, small, strong, blockquote, figcaption, ...), \`richtext\`, \`image\`, \`video\`, \`icon\` (\`name\`), \`link\` (takes children), \`button\` (\`variant\` ${list(BUTTON_VARIANTS)}), \`embed\` (\`provider\` ${list(EMBED_PROVIDERS)}). Unbound text elements show \`props.text\`, localized: \`{"en": "Read more", "de": "Weiterlesen"}\`.`,
    '- Data: `repeat` repeats its children for each entry of a list field, `blocks` shows a block field, `block` a single block, `template` a template reference.',
    '- Forms: `form` (`databagTypeId`, or bound to a databag field), `formField`, `formSubmit`, `formMessage`.',
    '- Layout only: `slot`, `menu` (`props.menu`: menu machine name, `props.design`: menu design key), `logo`, `breadcrumbs`, `localeSwitch`, `searchLink`.',
    '',
    'Bindings: `"bind": {"field": "<field id>"}`, optionally with a `format` (`date` with `style` short/medium/long, `number` with `decimals`, `style`, `currency`, `grouping: false` for years, `boolean`, `list`, `excerpt` with `length`). Inside a `repeat` bound to a field, children bind `<field id>.<sub-field id>` for repeater items, and `<field id>.$item` for the entry itself. A `repeat` over a `content` relation reaches the related documents: `<field id>.$item` is the document (a `link` bound to it links to it, a `text` or `heading` shows its title) and `<field id>.<field name>` one of its fields, e.g. `items.quote` or `projects.cover`. Pages also bind `$title`, `$permalink`, `$publishedAt`, `$author`; layouts additionally `$site.name` and `$site.logo`. `"visibility": {"whenField": "<path>"}` drops a node while that field is empty; `{"breakpoints": ["desktop", "tablet", "mobile"]}` lists where it shows.',
    '',
    '### Styles',
    '',
    '`style` is `{"base": {...}, "tablet": {...}, "mobile": {...}, "hover": {...}, "focus": {...}, "active": {...}}`; base is desktop, tablet and mobile override it below 1024px and 640px. Only these properties exist, and colors, spacing, type, radius and shadows are theme tokens, never raw CSS:',
    '',
    `- Properties: ${list(STYLE_PROP_NAMES)}.`,
    `- Colors: \`color:<role>\` with roles ${list(COLOR_ROLES)}, or \`color:<role>/<opacity 0-100>\`, e.g. \`color:primary/10\` for a tint. \`backgroundGradient\` is \`{"from": "color:primary", "via"?: ..., "to": "color:accent/45", "angle": 135}\`.`,
    '- Spacing (`padding*`, `margin*`, `gap`): `space:<step>` with steps 0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24 (0.25rem each), or `0`; margins also `auto`.',
    `- Type: \`type:<step>\` (${list(TYPE_STEPS)}), which also sets line height and weight, so set \`fontWeight\` after it; \`font:heading\`, \`font:body\`, \`font:mono\`. \`radius:none|sm|md|lg|full\` or \`0\`; \`shadow:sm|md|lg\` or \`none\`.`,
    '- Sizes take a unit (`50%`, `20rem`, `60vh`); `width` and `maxWidth` also take `container:sm|md|lg|xl`. Borders take one width for all sides: `borderWidth: "1px"`. There is no absolute positioning; place things with stacks and grids.',
    '',
    '### Making it look good',
    '',
    '- Build a page as a column of full-width `section` bands, each with generous vertical padding (`paddingY: "space:20"` to `"space:24"` on desktop, `"space:12"` to `"space:16"` on mobile), content in the container. Give a `blocks` element `gap: "0"` so band-shaped blocks sit edge to edge.',
    '- Alternate band backgrounds for rhythm: `color:bg`, `color:surface`, and one loud band (`color:primary` with `color:onPrimary` text, or a primary-to-accent gradient) for the call to action. Text on primary is always `color:onPrimary`; soft text there is `color:onPrimary/80`. `color:muted` is for secondary text on bg and surface only.',
    '- Use `accent` for small decoration (a 3rem by 0.3rem bar with `radius:full` above a heading, dots, quote marks), not for body text.',
    '- Headlines: `type:4xl` for the page hero, `type:3xl` for section headings, `type:xl` or `type:2xl` for card titles; limit lines with `maxWidth: "container:md"` or `"38rem"`.',
    '- Cards: `background` of the opposite band color or a `color:primary/5` tint, `radius:lg`, `shadow:md` with `shadow:lg` on hover, or a 1px `color:border` border turning `color:primary` on hover; inner padding `space:6`. Lay them out with a `repeat` styled `{"display": "grid", "columns": 3, "gap": "space:6"}`, `tablet: {"columns": 2}`, `mobile: {"columns": 1}`.',
    '- Put images in a `box` with a fixed `aspectRatio`, `overflow: "hidden"`, a radius and a primary-to-accent `backgroundGradient`, the `image` inside at `width: "100%"`, `height: "100%"`, `objectFit: "cover"`: the gradient shows until a picture is chosen, so a new site already looks finished.',
    '- Rows (`direction: "row"`) become columns on mobile (`mobile: {"direction": "column", "align": "stretch"}`). Style links inside cards with `textDecoration: "none"` and an explicit color.',
    '- Header: a `section` with `props.as: "header"`, a row with `logo` and `menu`; footer: a dark band (`background: "color:text"`, `color: "color:bg"`) or a surface band with the logo, the menu with a quiet footer menu design, and `$site.name`. Themes redefine every role for dark mode, so token colors keep working there.',
  ];

  if (!complete) {
    lines.push(
      '',
      `The full guide (${'`llms-full.txt`'}) adds the theme, menu and site design shapes and complete example designs.`,
    );
    return lines;
  }

  const { block, layout } = examples();
  const theme = themes.find((entry) => entry.id === 'neutral');
  lines.push(
    '',
    '### Theme, menu and site designs',
    '',
    '- Theme: `{colors: {palette, roles, dark}, fonts: {families, roles: {body, heading, mono}}, type, headings, body, space, radius, shadow, container: {widths, default, gutter}, elements: {body, link, button, buttons: {primary, secondary, ghost}, input, label, prose}}`. `roles` map each role to a palette name or a CSS color; `dark` overrides roles for dark mode. Fonts are `bundled` (shipped with the site), `google` (`plugins.website.design.importGoogleFont`) or `asset`.',
    '- Menu: `{"preset": "bar" | "list" | "dropdown" | "mega" | "columns", "depth": 1-3, "root"?: style, "levels": [{"list", "item", "link" (style rules), "current" (style props)}], "mobile": {"behaviour": "none" | "burger" | "offcanvas", "breakpoint": "tablet" | "mobile", "label", "toggle", "panel"}}`.',
    '- Block design: `{"variants": {"<name>": {"label", "root"}}, "default": "<name>"}`; an editor picks a variant per block, stored on the block value as `ext.website` `{"variant"?, "style"?}`.',
    '- Page design: `{"root", "layout"?, "seo"?: {"description": "<field id>", "image": "<field id>"}}`.',
    `- Icons: ${list(ICON_NAMES)}.`,
    '',
    'Element categories and which take children:',
    '',
    ...elements.map(
      ([name, info]) =>
        `- \`${name}\`: ${info.category}${info.container ? ', takes children' : ''}${info.requiresBind ? ', needs a binding' : ''}${info.textProps?.length ? `, localized ${list(info.textProps)}` : ''}`,
    ),
    '',
    '### Theme bundles',
    '',
    'A bundle carries a whole design between spaces: `{"format": "manablox-theme", "version": 1, "name", "theme"?, "designs": [{"kind": "block" | "page" | "layout" | "menu", "key", "name"?, "type"?, "data"}], "site"?}`. For block and page designs, `key` may be the type machine name and `type` `{"name": "<machine name>", "fields": {"<path used in bindings>": "<field name path>"}}`; bindings written with field names are then mapped onto the target space field ids on import, related-document paths included. This is how the design presets are written, and the easiest way to write designs without looking up field ids.',
    '',
    'The `hero` block of the `atlas` preset, for a type with `headline`, `subline` and `image` (bindings by field name):',
    '',
    '```json',
    JSON.stringify(block, null, 1),
    '```',
    '',
    'Its `default` layout:',
    '',
    '```json',
    JSON.stringify(layout, null, 1),
    '```',
    '',
    'The `neutral` starter theme:',
    '',
    '```json',
    JSON.stringify(theme?.theme, null, 1),
    '```',
  );
  return lines;
}
