import type { ScaffoldFile } from '../../scaffold.js';
import { type NamedModel, type NamedType, orderImports } from './codegen-common.js';

/** Component sets and the registry modules that map type names to renderers. */

/** An object key, unquoted when possible. */
function key(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : `'${name.replace(/'/g, "\\'")}'`;
}

export type CodegenFramework = 'vue' | 'react' | 'astro' | 'dom';

/** A component file per type plus a registry per kind, for the component frameworks. */
export function componentSet(
  framework: Exclude<CodegenFramework, 'dom'>,
  model: NamedModel,
  extension: string,
  component: (type: NamedType) => string,
): ScaffoldFile[] {
  return [
    ...model.blocks.map((type) => ({
      path: `src/components/blocks/${type.component}.${extension}`,
      content: component(type),
    })),
    { path: 'src/components/blocks/index.ts', content: registry(framework, 'block', model.blocks) },
    ...model.contents.map((type) => ({
      path: `src/components/content/${type.component}.${extension}`,
      content: component(type),
    })),
    {
      path: 'src/components/content/index.ts',
      content: registry(framework, 'content', model.contents),
    },
  ];
}

interface RegistrySpec {
  /** Import lines besides the components'. */
  imports: string[];
  importOf: (type: NamedType) => string;
  /** Sort imports like Biome; otherwise model order. */
  sorted: boolean;
  /** Declarations and doc comment above the map. */
  preamble: string[];
  valueType: string;
  value: (type: NamedType) => string;
}

const DOCUMENT_VIEW = [
  'export interface DocumentView {',
  '  title: string;',
  '  fields: Record<string, unknown>;',
  '}',
  '',
];

const DOCUMENT_VIEW_COMPONENT = [
  '/** What a content component is given: a published document, or the one the editor sends. */',
  ...DOCUMENT_VIEW,
];

const BLOCK_PROPS_DOC =
  '/** What every block component is given: the block, and where it sits in the document. */';

const BLOCK_REGISTRY_DOC = [
  '/**',
  " * The block renderer registry: a block renders through the component its type's name",
  ' * maps to. Written from the content model; a block type added later needs a line here.',
  ' */',
];

const contentRegistryDoc = (page: string) => [
  '/**',
  ' * The content component registry: a document whose type is named here renders through',
  ` * its component, any other as the generic article in \`${page}\`.`,
  ' */',
];

const ASTRO_ANY =
  '// biome-ignore lint/suspicious/noExplicitAny: what an Astro component is typed as';

const REGISTRIES: Record<CodegenFramework, Record<'block' | 'content', RegistrySpec>> = {
  vue: {
    block: {
      imports: ["import type { Component } from 'vue';"],
      importOf: (type) => `import ${type.component} from './${type.component}.vue';`,
      sorted: true,
      preamble: [
        '/**',
        " * The block renderer registry: a block renders through the component its type's name",
        ' * maps to, which takes the block and the path it sits at in the document. Written from',
        ' * the content model; a block type added later needs a line here.',
        ' */',
      ],
      valueType: 'Component',
      value: (type) => type.component,
    },
    content: {
      imports: ["import type { Component } from 'vue';"],
      importOf: (type) => `import ${type.component} from './${type.component}.vue';`,
      sorted: true,
      preamble: [
        ...DOCUMENT_VIEW_COMPONENT,
        '/**',
        ' * The content component registry: a document whose type is named here renders through',
        ' * its component, taking the document as `node`; any other renders as the generic',
        ' * article in `pages/Page.vue`.',
        ' */',
      ],
      valueType: 'Component',
      value: (type) => type.component,
    },
  },
  react: {
    block: {
      imports: [
        "import type { Block } from '@manablox/public-sdk';",
        "import type { ComponentType } from 'react';",
      ],
      importOf: (type) => `import { ${type.component} } from './${type.component}.js';`,
      sorted: true,
      preamble: [
        BLOCK_PROPS_DOC,
        'export interface BlockProps {',
        '  block: Block;',
        '  path: (string | number)[];',
        '}',
        '',
        ...BLOCK_REGISTRY_DOC,
      ],
      valueType: 'ComponentType<BlockProps>',
      value: (type) => type.component,
    },
    content: {
      imports: ["import type { ComponentType } from 'react';"],
      importOf: (type) => `import { ${type.component} } from './${type.component}.js';`,
      sorted: true,
      preamble: [...DOCUMENT_VIEW_COMPONENT, ...contentRegistryDoc('pages/Page.tsx')],
      valueType: 'ComponentType<{ node: DocumentView }>',
      value: (type) => type.component,
    },
  },
  astro: {
    block: {
      imports: [],
      importOf: (type) => `import ${type.component} from './${type.component}.astro';`,
      sorted: false,
      preamble: [
        BLOCK_PROPS_DOC,
        'export interface BlockProps {',
        '  block: Record<string, unknown>;',
        '  path: (string | number)[];',
        '}',
        '',
        ...BLOCK_REGISTRY_DOC,
        '// Astro types a component as a function of its props returning `any`, and a JSX tag',
        '// needs exactly that; `unknown` would not render.',
        ASTRO_ANY,
      ],
      valueType: '(props: BlockProps) => any',
      value: (type) => type.component,
    },
    content: {
      imports: [],
      importOf: (type) => `import ${type.component} from './${type.component}.astro';`,
      sorted: false,
      preamble: [
        ...DOCUMENT_VIEW_COMPONENT,
        ...contentRegistryDoc('pages/[...slug].astro'),
        ASTRO_ANY,
      ],
      valueType: '(props: { node: DocumentView }) => any',
      value: (type) => type.component,
    },
  },
  dom: {
    block: {
      imports: ["import type { Block } from '@manablox/public-sdk';"],
      importOf: (type) => `import { render${type.component} } from './${type.file}.js';`,
      sorted: false,
      preamble: [
        '/**',
        " * The block renderer registry: a block renders through the function its type's name maps",
        ' * to. Written from the content model; a block type added later needs a line here.',
        ' */',
        'export type BlockRenderer = (block: Block, path: (string | number)[]) => HTMLElement;',
        '',
      ],
      valueType: 'BlockRenderer',
      value: (type) => `render${type.component}`,
    },
    content: {
      imports: [],
      importOf: (type) => `import { render${type.component} } from './${type.file}.js';`,
      sorted: false,
      preamble: [
        '/** What a content renderer is given: a published document, or the one the editor sends. */',
        ...DOCUMENT_VIEW,
        'export type ContentRenderer = (node: DocumentView) => HTMLElement;',
        '',
        '/**',
        ' * The content renderer registry: a document whose type is named here renders through its',
        ' * renderer, any other through the generic article in `render.ts`.',
        ' */',
      ],
      valueType: 'ContentRenderer',
      value: (type) => `render${type.component}`,
    },
  },
};

/** A registry module: imports, declarations and the type name to renderer map. */
export function registry(
  framework: CodegenFramework,
  kind: 'block' | 'content',
  types: NamedType[],
): string {
  const spec = REGISTRIES[framework][kind];
  const lines = [...spec.imports, ...types.map(spec.importOf)];
  const imports = spec.sorted ? orderImports(lines) : lines;
  const head = `export const ${kind}Renderers: Record<string, ${spec.valueType}> =`;
  const map =
    types.length === 0
      ? [`${head} {};`, '']
      : [
          `${head} {`,
          ...types.map((type) => `  ${key(type.name)}: ${spec.value(type)},`),
          '};',
          '',
        ];
  return [...imports, ...(imports.length > 0 ? [''] : []), ...spec.preamble, ...map].join('\n');
}
