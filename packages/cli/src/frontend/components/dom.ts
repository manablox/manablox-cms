import type { ScaffoldFile } from '../../scaffold.js';
import {
  access,
  docComment,
  fieldPath,
  helpersFor,
  importLine,
  indent,
  itemPath,
  type NamedModel,
  type NamedType,
  orderImports,
  reader,
  type Slot,
  slotsFor,
  subSlots,
  uses,
} from './codegen-common.js';
import { registry } from './codegen-registry.js';

/** DOM renderers, for the `plain` frontend and Astro's in-browser preview canvas. */
export interface DomLayout {
  /** Folder of `dom.ts`, `blocks/` and `content/`. */
  root: string;
  /** Import path of `fields.ts` from `blocks/` or `content/`. */
  fields: string;
}

export function domFiles(model: NamedModel, layout: DomLayout): ScaffoldFile[] {
  return [
    ...model.blocks.map((type) => ({
      path: `${layout.root}/blocks/${type.file}.ts`,
      content: renderer(type, layout),
    })),
    { path: `${layout.root}/blocks/index.ts`, content: registry('dom', 'block', model.blocks) },
    ...model.contents.map((type) => ({
      path: `${layout.root}/content/${type.file}.ts`,
      content: renderer(type, layout),
    })),
    {
      path: `${layout.root}/content/index.ts`,
      content: registry('dom', 'content', model.contents),
    },
  ];
}

function renderer(type: NamedType, layout: DomLayout): string {
  const block = type.kind === 'block';
  const slots = slotsFor(type);
  const base = block ? 'block' : 'fields';

  const sdk = [
    ...(block ? ['type Block'] : []),
    ...(uses(slots, 'asset') ? ['type Asset', 'assetUrl', 'isImage'] : []),
  ];
  const renders = [
    ...(uses(slots, 'block') ? ['renderBlock'] : []),
    ...(uses(slots, 'blocks') ? ['renderBlocks'] : []),
  ];
  const helpers = helpersFor(slots);

  const imports = orderImports([
    "import { fieldAttribute } from '@manablox/live-preview';",
    ...(sdk.length > 0 ? [importLine(sdk, '@manablox/public-sdk')] : []),
    ...(block ? [] : ["import type { DocumentView } from './index.js';"]),
    "import { el } from '../dom.js';",
    ...(helpers.length > 0 ? [importLine(helpers, layout.fields)] : []),
    ...(renders.length > 0
      ? [importLine(renders, block ? './render.js' : '../blocks/render.js')]
      : []),
  ]);

  const locals = slots.map(
    (slot) => `  const ${slot.local} = ${reader(slot, access(base, slot.field.name))};`,
  );
  const children = [
    ...(block ? [] : ["el('h1', fieldAttribute(['title']), node.title || 'Untitled')"]),
    ...slots.map((slot) => child(slot, fieldPath(type, slot))),
  ];
  const rootClass = block ? `block block-${type.file}` : `content content-${type.file}`;
  const signature = block
    ? `export function render${type.component}(block: Block, path: (string | number)[]): HTMLElement {`
    : `export function render${type.component}(node: DocumentView): HTMLElement {`;

  const lines = [
    ...imports,
    '',
    ...docComment(
      type,
      slots,
      'Rich text is set as inner HTML only because `html()` escapes it; see `fields.ts`.',
    ),
    signature,
    ...(block ? [] : ['  const fields = node.fields;']),
    ...locals,
    ...(locals.length > 0 || !block ? [''] : []),
    '  return el(',
    `    '${block ? 'section' : 'article'}',`,
    block
      ? `    { class: '${rootClass}', ...fieldAttribute(path) },`
      : `    { class: '${rootClass}' },`,
    ...children.map((entry) => indent(`${entry},`, 4)),
    '  );',
    '}',
  ];

  if (uses(slots, 'asset')) {
    lines.push(
      '',
      '/** An image through its `card` preset, anything else as a link to the file. */',
      'function renderAsset(asset: Asset): HTMLElement {',
      '  if (!isImage(asset)) {',
      "    return el('a', { href: asset.url }, asset.title ?? asset.filename);",
      '  }',
      "  return el('img', {",
      "    src: assetUrl(asset, { preset: 'card' }),",
      "    alt: asset.alt ?? '',",
      '    width: asset.width ? String(asset.width) : undefined,',
      '    height: asset.height ? String(asset.height) : undefined,',
      "    loading: 'lazy',",
      "    decoding: 'async',",
      '  });',
      '}',
    );
  }

  return `${lines.join('\n')}\n`;
}

/** A field's element, or `null` when empty. */
function child(slot: Slot, path: string): string {
  const value = slot.local;
  const attrs = `fieldAttribute(${path})`;
  switch (slot.field.render) {
    case 'text':
    case 'user':
      return `${value} ? el('${slot.heading ? 'h2' : 'p'}', ${attrs}, ${value}) : null`;
    case 'date':
      return [
        value,
        '  ? el(',
        "      'p',",
        `      ${attrs},`,
        `      el('time', { datetime: ${value}.iso }, ${value}.label),`,
        '    )',
        '  : null',
      ].join('\n');
    case 'richtext':
      return `${value} ? Object.assign(el('div', ${attrs}), { innerHTML: ${value} }) : null`;
    case 'json':
      return `${value} ? el('pre', ${attrs}, ${value}) : null`;
    case 'asset':
      return `${value}.length > 0 ? el('div', ${attrs}, ...${value}.map(renderAsset)) : null`;
    case 'content':
      return [
        `${value}.length > 0`,
        `  ? el(`,
        `      'ul',`,
        `      ${attrs},`,
        `      ...${value}.map((entry) => el('li', {}, el('a', { href: href(entry) }, entry.title))),`,
        '    )',
        '  : null',
      ].join('\n');
    case 'link':
      return [
        `${value}`,
        `  ? el(`,
        `      'p',`,
        `      ${attrs},`,
        '      el(',
        "        'a',",
        `        {`,
        `          href: ${value}.href,`,
        `          target: ${value}.newTab ? '_blank' : undefined,`,
        `          rel: ${value}.newTab ? 'noreferrer' : undefined,`,
        '        },',
        `        ${value}.label,`,
        '      ),',
        '    )',
        '  : null',
      ].join('\n');
    case 'blocks':
      return `renderBlocks(${value}, ${path})`;
    case 'block':
      return `${value} ? renderBlock(${value}, ${path}) : null`;
    case 'items':
      return [
        `${value}.length > 0`,
        '  ? el(',
        "      'ol',",
        `      ${attrs},`,
        `      ...${value}.map((item, index) =>`,
        '        el(',
        "          'li',",
        '          {},',
        ...subSlots(slot).map(
          (sub) =>
            `          ${sub.value} ? el('${sub.tag}', fieldAttribute(${itemPath(path, sub)}), ${sub.value}) : null,`,
        ),
        '        ),',
        '      ),',
        '    )',
        '  : null',
      ].join('\n');
  }
}
