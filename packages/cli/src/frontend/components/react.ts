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

/** React components and their registries. */
export function reactComponents(model: NamedModel): ScaffoldFile[] {
  return componentSet('react', model, 'tsx', component);
}

function component(type: NamedType): string {
  const block = type.kind === 'block';
  const slots = slotsFor(type);
  const base = block ? 'block' : 'fields';
  const helpers = helpersFor(slots);
  const sdk = [
    ...(uses(slots, 'asset') ? ['assetUrl', 'isImage'] : []),
    ...(uses(slots, 'blocks') ? ['blocksOf'] : []),
  ];
  const singles = slots.filter((slot) => slot.field.render === 'block');
  const registryFrom = block ? './index.js' : '../blocks/index.js';

  const imports = orderImports([
    "import { fieldAttribute } from '@manablox/live-preview';",
    ...(sdk.length > 0 ? [importLine(sdk, '@manablox/public-sdk')] : []),
    ...(helpers.length > 0 ? [importLine(helpers, '../../lib/fields.js')] : []),
    ...(uses(slots, 'blocks') ? ["import { Blocks } from '../Blocks.js';"] : []),
    ...(block
      ? [
          importLine(
            ['type BlockProps', ...(singles.length > 0 ? ['blockRenderers'] : [])],
            './index.js',
          ),
        ]
      : [
          ...(singles.length > 0 ? [importLine(['blockRenderers'], registryFrom)] : []),
          "import type { DocumentView } from './index.js';",
        ]),
  ]);

  const locals = slots.flatMap((slot) => {
    const line = `  const ${slot.local} = ${reader(slot, access(base, slot.field.name))};`;
    if (slot.field.render !== 'block') return [line];
    const tag = rendererName(slot);
    return [
      line,
      `  const ${tag} = ${slot.local} ? blockRenderers[${slot.local}.type] : undefined;`,
    ];
  });

  const lines = [
    ...imports,
    '',
    ...docComment(type, slots),
    block
      ? `export function ${type.component}({ block, path }: BlockProps) {`
      : `export function ${type.component}({ node }: { node: DocumentView }) {`,
    ...(block ? [] : ['  const fields = node.fields;']),
    ...locals,
    ...(locals.length > 0 || !block ? [''] : []),
    '  return (',
    block
      ? `    <section className="block block-${type.file}" {...fieldAttribute(path)}>`
      : `    <article className="content content-${type.file}">`,
    ...(block ? [] : ["      <h1 {...fieldAttribute(['title'])}>{node.title || 'Untitled'}</h1>"]),
    ...slots.map((slot) => indent(markup(slot, fieldPath(type, slot)), 6)),
    block ? '    </section>' : '    </article>',
    '  );',
    '}',
  ];
  return `${lines.join('\n')}\n`;
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
      return [
        `{${value} && (`,
        `  <p ${attrs}>`,
        `    <time dateTime={${value}.iso}>{${value}.label}</time>`,
        '  </p>',
        ')}',
      ].join('\n');
    case 'richtext':
      return [
        `{${value} && (`,
        '  // Safe only because `html()` escapes the rich text; see `fields.ts`.',
        '  // biome-ignore lint/security/noDangerouslySetInnerHtml: the SDK escapes it',
        `  <div ${attrs} dangerouslySetInnerHTML={{ __html: ${value} }} />`,
        ')}',
      ].join('\n');
    case 'json':
      return `{${value} && <pre ${attrs}>{${value}}</pre>}`;
    case 'asset':
      return [
        `{${value}.length > 0 && (`,
        `  <div ${attrs}>`,
        `    {${value}.map((asset) =>`,
        '      isImage(asset) ? (',
        '        <img',
        '          key={asset.id}',
        "          src={assetUrl(asset, { preset: 'card' })}",
        "          alt={asset.alt ?? ''}",
        '          width={asset.width ?? undefined}',
        '          height={asset.height ?? undefined}',
        '          loading="lazy"',
        '          decoding="async"',
        '        />',
        '      ) : (',
        '        <a key={asset.id} href={asset.url}>',
        '          {asset.title ?? asset.filename}',
        '        </a>',
        '      ),',
        '    )}',
        '  </div>',
        ')}',
      ].join('\n');
    case 'content':
      return [
        `{${value}.length > 0 && (`,
        `  <ul ${attrs}>`,
        `    {${value}.map((entry) => (`,
        '      <li key={entry.id}>',
        '        <a href={href(entry)}>{entry.title}</a>',
        '      </li>',
        '    ))}',
        '  </ul>',
        ')}',
      ].join('\n');
    case 'link':
      return [
        `{${value} && (`,
        `  <p ${attrs}>`,
        '    <a',
        `      href={${value}.href}`,
        `      target={${value}.newTab ? '_blank' : undefined}`,
        `      rel={${value}.newTab ? 'noreferrer' : undefined}`,
        '    >',
        `      {${value}.label}`,
        '    </a>',
        '  </p>',
        ')}',
      ].join('\n');
    case 'blocks':
      return `<Blocks blocks={blocksOf(${value})} path={${path}} value={${value}} />`;
    case 'items':
      return [
        `{${value}.length > 0 && (`,
        `  <ol ${attrs}>`,
        `    {${value}.map((item, index) => (`,
        '      <li key={item.itemId}>',
        ...subSlots(slot).map(
          (sub) =>
            `        {${sub.value} && <${sub.tag} {...fieldAttribute(${itemPath(path, sub)})}>{${sub.value}}</${sub.tag}>}`,
        ),
        '      </li>',
        '    ))}',
        '  </ol>',
        ')}',
      ].join('\n');
    case 'block': {
      const tag = rendererName(slot);
      return [
        `{${value} && ${tag} && (`,
        `  <${tag} block={${value}} path={${path}} />`,
        ')}',
      ].join('\n');
    }
  }
}
