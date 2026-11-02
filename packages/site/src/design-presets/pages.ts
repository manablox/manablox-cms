import { generatePageDesign } from '../generate.js';
import type { DesignNode, PageDesign, StyleProps } from '../types.js';
import { BAND_BLOCKS } from './blocks.js';
import {
  band,
  fieldOf,
  frame,
  kicker,
  kids,
  node,
  type PresetType,
  type Recipe,
  say,
  softText,
  title,
  when,
} from './kit.js';
import type { Tone } from './look.js';

type PageRecipe = (
  recipe: Recipe,
  type: PresetType,
  all: readonly PresetType[],
) => PageDesign | null;

const prose = (id: string, bind: string): DesignNode =>
  node(id, 'richtext', {
    bind,
    style: { base: { type: 'type:lg' }, mobile: { type: 'type:base' } },
    visibility: when(bind),
  });

/** The tone of a page header by the look. */
function headerTone(recipe: Recipe): Tone {
  switch (recipe.look.pageHeader) {
    case 'band':
      return recipe.look.alternate;
    case 'gradient':
      return 'gradient';
    case 'plain':
      return 'bg';
  }
}

/** The top of a page: kicker, title and summary on the look's page header. */
function pageHeader(
  recipe: Recipe,
  type: PresetType,
  options: { tone?: Tone; eyebrow?: DesignNode | false; center?: boolean } = {},
): DesignNode {
  const { look } = recipe;
  const tone = options.tone ?? headerTone(recipe);
  const ruled = !options.tone && look.pageHeader === 'plain';
  const center = options.center ?? look.titles.center;
  const summary = fieldOf(type, 'summary', 'string');
  return band(
    'header',
    look,
    tone,
    kids(
      node('intro', 'stack', {
        style: {
          base: {
            gap: 'space:5',
            maxWidth: 'container:md',
            ...(center ? { marginX: 'auto', align: 'center', textAlign: 'center' } : {}),
          },
        },
        children: kids(
          options.eyebrow ?? kicker('kicker', look, tone),
          title('title', look, { bind: '$title', level: 1, type: 'type:4xl' }),
          summary &&
            node('summary', 'text', {
              bind: 'summary',
              style: {
                base: { type: 'type:xl', color: softText(tone) },
                mobile: { type: 'type:lg' },
              },
              visibility: when('summary'),
            }),
        ),
      }),
      ruled &&
        node('header-rule', 'divider', {
          style: { base: { borderColor: 'color:text', marginTop: 'space:12' } },
        }),
    ),
    { style: { paddingTop: 'space:20', paddingBottom: tone === 'bg' ? 'space:10' : 'space:20' } },
  );
}

/** A date in small capitals above a title. */
function dateLine(field: string, tone: Tone): DesignNode {
  return node('date', 'text', {
    bind: field,
    format: { type: 'date', style: 'long' },
    style: {
      base: {
        type: 'type:sm',
        fontWeight: 700,
        textTransform: 'uppercase',
        color: tone === 'bg' || tone === 'surface' ? 'color:primary' : softText(tone),
      },
    },
    visibility: when(field),
  });
}

/**
 * Running text; `joined` follows a header on the same background without a second gap.
 * Centered under a centered header, else aligned with it.
 */
function readingBand(
  recipe: Recipe,
  children: DesignNode[],
  joined = false,
  center = recipe.look.titles.center,
): DesignNode {
  return band(
    'main',
    recipe.look,
    'bg',
    [
      node('reading', 'stack', {
        style: {
          base: {
            gap: 'space:8',
            maxWidth: `container:${recipe.look.reading}`,
            ...(center ? { marginX: 'auto' } : {}),
          },
        },
        children,
      }),
    ],
    joined ? { style: { paddingTop: '0' } } : {},
  );
}

/** Pages built from blocks: bands stack edge to edge, cards sit in a container. */
const blockPage: PageRecipe = (recipe, type, all) => {
  const blocks = type.fields.find((field) => field.type === 'blocks');
  if (!blocks) return null;
  const bands = all.some((entry) => entry.kind === 'block' && BAND_BLOCKS.has(entry.name));
  const list = node('blocks', 'blocks', {
    bind: blocks.name,
    style: { base: { gap: bands ? '0' : 'space:6' } },
  });
  if (bands) return { root: node('root', 'stack', { children: [list] }) };
  return {
    root: node('root', 'stack', {
      children: [pageHeader(recipe, type), band('main', recipe.look, 'bg', [list])],
    }),
  };
};

/** Plain pages of text. */
const textPage: PageRecipe = (recipe, type) => {
  const body = fieldOf(type, 'body', 'richtext');
  if (!body) return null;
  return {
    root: node('root', 'stack', {
      children: [
        pageHeader(recipe, type),
        readingBand(recipe, [prose('body', 'body')], headerTone(recipe) === 'bg'),
      ],
    }),
  };
};

/** Dated writing: date, title, summary, a wide cover and the text. */
const writing =
  (image: string): PageRecipe =>
  (recipe, type) => {
    const body = fieldOf(type, 'body', 'richtext');
    if (!body) return null;
    const { look } = recipe;
    const cover = fieldOf(type, image, 'asset');
    const date = fieldOf(type, 'date', 'date');
    const tone: Tone = look.pageHeader === 'gradient' ? 'gradient' : 'bg';
    return {
      root: node('root', 'stack', {
        props: { as: 'article' },
        children: kids(
          pageHeader(recipe, type, {
            tone,
            center: true,
            eyebrow: date ? dateLine('date', tone) : false,
          }),
          cover &&
            node('cover-band', 'section', {
              props: { container: 'lg' },
              ...(tone === 'bg' ? {} : { style: { base: { paddingTop: 'space:12' } } }),
              visibility: when(image),
              children: [
                frame('cover', look, image, {
                  ratio: '16/9',
                  style: { width: '100%', shadow: 'shadow:lg' },
                }),
              ],
            }),
          readingBand(recipe, [prose('body', 'body')], false, true),
        ),
      }),
    };
  };

/** A project: title, facts, cover, text and gallery. */
const projectPage: PageRecipe = (recipe, type) => {
  const { look } = recipe;
  const facts = (
    [
      ['client', say(recipe, { en: 'Client', de: 'Kunde' })],
      ['year', say(recipe, { en: 'Year', de: 'Jahr' })],
      ['role', say(recipe, { en: 'Role', de: 'Rolle' })],
    ] as const
  ).filter(([name]) => fieldOf(type, name));
  const cover = fieldOf(type, 'cover', 'asset');
  const gallery = fieldOf(type, 'gallery', 'asset');
  const body = fieldOf(type, 'body', 'richtext');
  const factStyle: StyleProps = {
    type: 'type:xs',
    fontWeight: 700,
    textTransform: 'uppercase',
    color: 'color:muted',
  };
  return {
    root: node('root', 'stack', {
      props: { as: 'article' },
      children: kids(
        pageHeader(recipe, type, { tone: 'bg' }),
        facts.length > 0 &&
          node('facts-band', 'section', {
            children: [
              node('facts', 'grid', {
                style: {
                  base: {
                    columns: facts.length,
                    gap: 'space:6',
                    paddingY: 'space:6',
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderColor: 'color:border',
                    paddingX: 'space:6',
                    radius: look.radius,
                  },
                  mobile: { columns: 1 },
                },
                children: facts.map(([name, label]) =>
                  node(`fact-${name}`, 'stack', {
                    style: { base: { gap: 'space:1' } },
                    visibility: when(name),
                    children: [
                      node(`fact-${name}-label`, 'text', {
                        props: { as: 'small', text: label },
                        style: { base: factStyle },
                      }),
                      node(`fact-${name}-value`, 'text', {
                        bind: name,
                        ...(name === 'year' ? { format: { type: 'number', grouping: false } } : {}),
                        style: { base: { type: 'type:lg', fontWeight: 600 } },
                      }),
                    ],
                  }),
                ),
              }),
            ],
          }),
        cover &&
          node('cover-band', 'section', {
            props: { container: 'xl' },
            visibility: when('cover'),
            children: [frame('cover', look, 'cover', { ratio: '16/9', style: { width: '100%' } })],
          }),
        body && readingBand(recipe, [prose('body', 'body')]),
        gallery &&
          band(
            'gallery-band',
            look,
            look.alternate,
            [
              node('gallery', 'repeat', {
                bind: 'gallery',
                style: {
                  base: { display: 'grid', columns: 2, gap: 'space:6' },
                  mobile: { columns: 1 },
                },
                children: [frame('shot', look, 'gallery.$item', { ratio: '4/3' })],
              }),
            ],
            { container: 'xl', visibility: when('gallery') },
          ),
      ),
    }),
  };
};

/** A service: header band, then text beside its image. */
const servicePage: PageRecipe = (recipe, type) => {
  const body = fieldOf(type, 'body', 'richtext');
  if (!body) return null;
  const image = fieldOf(type, 'image', 'asset');
  return {
    root: node('root', 'stack', {
      children: [
        pageHeader(recipe, type),
        band('main', recipe.look, 'bg', [
          node('row', 'stack', {
            style: {
              base: { direction: 'row', align: 'start', gap: 'space:16' },
              mobile: { direction: 'column', gap: 'space:8' },
            },
            children: kids(
              node('text', 'box', {
                style: { base: { grow: true, maxWidth: 'container:sm' } },
                children: [prose('body', 'body')],
              }),
              image &&
                frame('media', recipe.look, 'image', {
                  ratio: '4/3',
                  style: { width: '40%', shadow: 'shadow:md' },
                  mobile: { width: '100%' },
                  visibility: when('image'),
                }),
            ),
          }),
        ]),
      ],
    }),
  };
};

/** Any other type: the page header, then the generated field elements in a container. */
const genericPage: PageRecipe = (recipe, type) => {
  const generated = generatePageDesign({
    fields: type.fields.map((field, index) => ({
      id: field.name,
      name: field.name,
      type: field.type,
      settings: field.settings ?? {},
      required: false,
      localized: false,
      unique: false,
      label: field.name,
      admin: { zone: 'main', width: 100, position: index },
    })),
  });
  const content = generated.root.children?.[0]?.children?.[0];
  const fields = (content?.children ?? []).filter(
    (entry) => entry.id !== 'title' && entry.bind?.field !== 'summary',
  );
  return {
    root: node('root', 'stack', {
      children: kids(
        pageHeader(recipe, type),
        fields.length > 0 &&
          band('main', recipe.look, 'bg', [
            node('fields', 'stack', { style: { base: { gap: 'space:8' } }, children: fields }),
          ]),
      ),
    }),
  };
};

const PAGES: Record<string, PageRecipe> = {
  article: writing('image'),
  post: writing('cover'),
  project: projectPage,
  service: servicePage,
};

/** The page design of a document type: known names first, then by the fields it has. */
export function presetPage(
  recipe: Recipe,
  type: PresetType,
  all: readonly PresetType[],
): PageDesign | null {
  const named = PAGES[type.name]?.(recipe, type, all);
  if (named) return named;
  return (
    blockPage(recipe, type, all) ?? textPage(recipe, type, all) ?? genericPage(recipe, type, all)
  );
}
