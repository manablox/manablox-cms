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
import { componentSet } from './codegen-registry.js';

/** Vue single-file components and their registries. */
export function vueComponents(model: NamedModel): ScaffoldFile[] {
  return componentSet('vue', model, 'vue', component);
}

function component(type: NamedType): string {
  const block = type.kind === 'block';
  const slots = slotsFor(type);
  // Via `props` so editor updates recompute every field.
  const base = block ? 'props.block' : 'props.node.fields';
  const helpers = helpersFor(slots);
  const sdk = [
    ...(block ? ['type Block'] : []),
    ...(uses(slots, 'asset') ? ['assetUrl', 'isImage'] : []),
    ...(uses(slots, 'blocks') ? ['blocksOf'] : []),
  ];
  const singles = slots.some((slot) => slot.field.render === 'block');

  const imports = orderImports([
    "import { fieldAttribute } from '@manablox/live-preview';",
    ...(sdk.length > 0 ? [importLine(sdk, '@manablox/public-sdk')] : []),
    ...(slots.length > 0 ? ["import { computed } from 'vue';"] : []),
    ...(helpers.length > 0 ? [importLine(helpers, '../../lib/fields.js')] : []),
    ...(uses(slots, 'blocks') ? ["import Blocks from '../Blocks.vue';"] : []),
    ...(singles
      ? [`import { blockRenderers } from '${block ? './index.js' : '../blocks/index.js'}';`]
      : []),
    ...(block ? [] : ["import type { DocumentView } from './index.js';"]),
  ]);

  const script = [
    '<script setup lang="ts">',
    ...imports,
    '',
    ...docComment(
      type,
      slots,
      '`v-html` is safe only because `html()` escapes the rich text; see `fields.ts`.',
    ),
    block
      ? 'const props = defineProps<{ block: Block; path: (string | number)[] }>();'
      : 'const props = defineProps<{ node: DocumentView }>();',
    ...(slots.length > 0 ? [''] : []),
    ...slots.map(
      (slot) =>
        `const ${slot.local} = computed(() => ${reader(slot, access(base, slot.field.name))});`,
    ),
    '</script>',
  ];

  const template = [
    '<template>',
    block
      ? `  <section class="block block-${type.file}" v-bind="fieldAttribute(path)">`
      : `  <article class="content content-${type.file}">`,
    ...(block
      ? []
      : ["    <h1 v-bind=\"fieldAttribute(['title'])\">{{ node.title || 'Untitled' }}</h1>"]),
    ...slots.map((slot) => indent(markup(slot, fieldPath(type, slot)), 4)),
    block ? '  </section>' : '  </article>',
    '</template>',
  ];

  return `${[...script, '', ...template].join('\n')}\n`;
}

function markup(slot: Slot, path: string): string {
  const value = slot.local;
  const attrs = `v-bind="fieldAttribute(${path})"`;
  switch (slot.field.render) {
    case 'text':
    case 'user': {
      const tag = slot.heading ? 'h2' : 'p';
      return `<${tag} v-if="${value}" ${attrs}>{{ ${value} }}</${tag}>`;
    }
    case 'date':
      return [
        `<p v-if="${value}" ${attrs}>`,
        `  <time :datetime="${value}.iso">{{ ${value}.label }}</time>`,
        '</p>',
      ].join('\n');
    case 'richtext':
      return `<div v-if="${value}" ${attrs} v-html="${value}"></div>`;
    case 'json':
      return `<pre v-if="${value}" ${attrs}>{{ ${value} }}</pre>`;
    case 'asset':
      return [
        `<div v-if="${value}.length > 0" ${attrs}>`,
        `  <template v-for="asset in ${value}" :key="asset.id">`,
        '    <img',
        '      v-if="isImage(asset)"',
        `      :src="assetUrl(asset, { preset: 'card' })"`,
        `      :alt="asset.alt ?? ''"`,
        '      :width="asset.width ?? undefined"',
        '      :height="asset.height ?? undefined"',
        '      loading="lazy"',
        '      decoding="async"',
        '    />',
        '    <a v-else :href="asset.url">{{ asset.title ?? asset.filename }}</a>',
        '  </template>',
        '</div>',
      ].join('\n');
    case 'content':
      return [
        `<ul v-if="${value}.length > 0" ${attrs}>`,
        `  <li v-for="entry in ${value}" :key="entry.id">`,
        '    <a :href="href(entry)">{{ entry.title }}</a>',
        '  </li>',
        '</ul>',
      ].join('\n');
    case 'link':
      return [
        `<p v-if="${value}" ${attrs}>`,
        '  <a',
        `    :href="${value}.href"`,
        `    :target="${value}.newTab ? '_blank' : undefined"`,
        `    :rel="${value}.newTab ? 'noreferrer' : undefined"`,
        '  >',
        `    {{ ${value}.label }}`,
        '  </a>',
        '</p>',
      ].join('\n');
    case 'blocks':
      return `<Blocks :blocks="blocksOf(${value})" :path="${path}" :value="${value}" />`;
    case 'items':
      return [
        `<ol v-if="${value}.length > 0" ${attrs}>`,
        `  <li v-for="(item, index) in ${value}" :key="item.itemId">`,
        ...subSlots(slot).map(
          (sub) =>
            `    <${sub.tag} v-if="${sub.value}" v-bind="fieldAttribute(${itemPath(path, sub)})">{{ ${sub.value} }}</${sub.tag}>`,
        ),
        '  </li>',
        '</ol>',
      ].join('\n');
    case 'block':
      // A single block renders through the registry too.
      return [
        '<component',
        `  :is="blockRenderers[${value}.type]"`,
        `  v-if="${value} && blockRenderers[${value}.type]"`,
        `  :block="${value}"`,
        `  :path="${path}"`,
        '/>',
      ].join('\n');
  }
}
