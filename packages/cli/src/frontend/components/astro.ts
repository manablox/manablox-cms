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
  rendererName,
  type Slot,
  slotsFor,
  subSlots,
  uses,
} from './codegen-common.js';
import { componentSet } from './codegen-registry.js';

/** Astro components and registries, plus DOM renderers for the preview canvas. */
export function astroComponents(model: NamedModel): ScaffoldFile[] {
  return componentSet('astro', model, 'astro', component);
}

function component(type: NamedType): string {
  const block = type.kind === 'block';
  const slots = slotsFor(type);
  const base = block ? 'block' : 'fields';
  const helpers = helpersFor(slots);
  const sdk = [
    ...(uses(slots, 'asset') ? ['assetUrl', 'isImage'] : []),
    ...(uses(slots, 'blocks') ? ['blocksOf', 'gridOf'] : []),
  ];
  const singles = slots.filter((slot) => slot.field.render === 'block');

  const imports = orderImports([
    "import { fieldAttribute } from '@manablox/live-preview';",
    ...(sdk.length > 0 ? [importLine(sdk, '@manablox/public-sdk')] : []),
    ...(helpers.length > 0 ? [importLine(helpers, '../../lib/fields')] : []),
    ...(uses(slots, 'blocks') ? ["import Blocks from '../Blocks.astro';"] : []),
    ...(singles.length > 0
      ? [`import { blockRenderers } from '${block ? './index' : '../blocks/index'}';`]
      : []),
    ...(block ? [] : ["import type { DocumentView } from './index';"]),
  ]);

  const locals = slots.flatMap((slot) => {
    const line = `const ${slot.local} = ${reader(slot, access(base, slot.field.name))};`;
    if (slot.field.render !== 'block') return [line];
    // A single block renders through the registry too.
    const tag = rendererName(slot);
    return [line, `const ${tag} = ${slot.local} ? blockRenderers[${slot.local}.type] : undefined;`];
  });

  const frontmatter = [
    '---',
    ...imports,
    '',
    ...docComment(
      type,
      slots,
      '`set:html` is safe only because `html()` escapes the rich text; see `fields.ts`.',
    ),
    'interface Props {',
    ...(block
      ? ['  block: Record<string, unknown>;', '  path: (string | number)[];']
      : ['  node: DocumentView;']),
    '}',
    '',
    block ? 'const { block, path } = Astro.props;' : 'const { node } = Astro.props;',
    ...(block ? [] : ['const fields = node.fields;']),
    ...locals,
    '---',
  ];

  const body = [
    block
      ? `<section class="block block-${type.file}" {...fieldAttribute(path)}>`
      : `<article class="content content-${type.file}">`,
    ...(block ? [] : ["  <h1 {...fieldAttribute(['title'])}>{node.title || 'Untitled'}</h1>"]),
    ...slots.map((slot) => indent(markup(slot, fieldPath(type, slot)), 2)),
    block ? '</section>' : '</article>',
  ];

  return `${[...frontmatter, '', ...body].join('\n')}\n`;
}

function markup(slot: Slot, path: string): string {
  const value = slot.local;
  const attrs = `{...fieldAttribute(${path})}`;
  switch (slot.field.render) {
    case 'text':
    case 'user': {
      const tag = slot.heading ? 'h2' : 'p';
      return `{${value} && <${tag} ${attrs}>{${value}}</${tag}>}`;
    }
    case 'date':
      return `{\n  ${value} && (\n    <p ${attrs}>\n      <time datetime={${value}.iso}>{${value}.label}</time>\n    </p>\n  )\n}`;
    case 'richtext':
      return `{${value} && <div ${attrs} set:html={${value}} />}`;
    case 'json':
      return `{${value} && <pre ${attrs}>{${value}}</pre>}`;
    case 'asset':
      return [
        '{',
        `  ${value}.length > 0 && (`,
        `    <div ${attrs}>`,
        `      {${value}.map((asset) =>`,
        '        isImage(asset) ? (',
        '          <img',
        "            src={assetUrl(asset, { preset: 'card' })}",
        "            alt={asset.alt ?? ''}",
        '            width={asset.width ?? undefined}',
        '            height={asset.height ?? undefined}',
        '            loading="lazy"',
        '            decoding="async"',
        '          />',
        '        ) : (',
        '          <a href={asset.url}>{asset.title ?? asset.filename}</a>',
        '        ),',
        '      )}',
        '    </div>',
        '  )',
        '}',
      ].join('\n');
    case 'content':
      return [
        '{',
        `  ${value}.length > 0 && (`,
        `    <ul ${attrs}>`,
        `      {${value}.map((entry) => (`,
        '        <li>',
        '          <a href={href(entry)}>{entry.title}</a>',
        '        </li>',
        '      ))}',
        '    </ul>',
        '  )',
        '}',
      ].join('\n');
    case 'link':
      return [
        '{',
        `  ${value} && (`,
        `    <p ${attrs}>`,
        '      <a',
        `        href={${value}.href}`,
        `        target={${value}.newTab ? '_blank' : undefined}`,
        `        rel={${value}.newTab ? 'noreferrer' : undefined}`,
        '      >',
        `        {${value}.label}`,
        '      </a>',
        '    </p>',
        '  )',
        '}',
      ].join('\n');
    case 'blocks':
      return `<Blocks blocks={blocksOf(${value})} path={${path}} grid={gridOf(${value})} />`;
    case 'items':
      return [
        '{',
        `  ${value}.length > 0 && (`,
        `    <ol ${attrs}>`,
        `      {${value}.map((item, index) => (`,
        '        <li>',
        ...subSlots(slot).map(
          (sub) =>
            `          {${sub.value} && <${sub.tag} {...fieldAttribute(${itemPath(path, sub)})}>{${sub.value}}</${sub.tag}>}`,
        ),
        '        </li>',
        '      ))}',
        '    </ol>',
        '  )',
        '}',
      ].join('\n');
    case 'block': {
      const tag = rendererName(slot);
      return ['{', `  ${value} && ${tag} && <${tag} block={${value}} path={${path}} />`, '}'].join(
        '\n',
      );
    }
  }
}
