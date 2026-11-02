import type { BlockDesign, DesignNode, StyleProps } from '../types.js';
import {
  arrow,
  band,
  cardBar,
  cardPadding,
  cardStyle,
  fieldOf,
  frame,
  gridStyle,
  hasFields,
  inkOf,
  isLoud,
  kicker,
  kids,
  node,
  type PresetType,
  type Recipe,
  say,
  sectionHead,
  softText,
  title,
  toneStyle,
  when,
} from './kit.js';
import type { Look, Tone } from './look.js';

type BlockRecipe = (recipe: Recipe, type: PresetType) => DesignNode | null;

/** Link text and color on a tone, without the theme's underline. */
function plainLink(tone: Tone): StyleProps {
  return {
    color: isLoud(tone) ? inkOf(tone) : 'color:text',
    textDecoration: 'none',
  };
}

const hero: BlockRecipe = ({ look }, type) => {
  if (!hasFields(type, { headline: 'string' })) return null;
  const subline = fieldOf(type, 'subline', 'string');
  const image = fieldOf(type, 'image', 'asset');
  const tone = look.heroTone;
  const soft = softText(tone);
  const wash: StyleProps =
    tone === 'bg' || tone === 'surface'
      ? {
          backgroundGradient: {
            from: 'color:primary/10',
            via: tone === 'bg' ? 'color:bg' : 'color:surface',
            to: 'color:accent/10',
            angle: 160,
          },
        }
      : {};
  const heading = (center: boolean) =>
    title('headline', look, {
      bind: 'headline',
      level: 1,
      type: 'type:4xl',
      style: {
        ...(look.hero === 'display' ? { fontWeight: 800 } : {}),
        ...(center ? { textAlign: 'center' } : {}),
      },
    });
  const sub = (style: StyleProps = {}) =>
    subline &&
    node('subline', 'text', {
      bind: 'subline',
      style: {
        base: { type: 'type:xl', color: soft, maxWidth: '38rem', ...style },
        mobile: { type: 'type:lg' },
      },
      visibility: when('subline'),
    });
  const button = fieldOf(type, 'button', 'link');
  /** The hero's button; secondary on a loud tone, so it stands off the color. */
  const action = (center = false) =>
    button &&
    node('button', 'button', {
      bind: 'button',
      props: { variant: isLoud(tone) ? 'secondary' : 'primary' },
      style: {
        base: {
          alignSelf: center ? 'center' : 'start',
          paddingX: 'space:6',
          marginTop: 'space:2',
        },
        mobile: { alignSelf: 'stretch' },
      },
      visibility: when('button'),
    });

  switch (look.hero) {
    case 'split':
      return band(
        'root',
        look,
        tone,
        [
          node('row', 'stack', {
            style: {
              base: {
                direction: look.mirror ? 'row-reverse' : 'row',
                align: 'center',
                gap: 'space:16',
              },
              tablet: { gap: 'space:10' },
              mobile: { direction: 'column', align: 'stretch', gap: 'space:10' },
            },
            children: kids(
              node('copy', 'stack', {
                style: {
                  base: { gap: 'space:6', grow: true, width: '50%' },
                  mobile: { width: '100%' },
                },
                children: kids(kicker('kicker', look, tone), heading(false), sub(), action()),
              }),
              image &&
                frame('media', look, 'image', {
                  ratio: '4/3',
                  style: { width: '46%', shadow: 'shadow:lg' },
                  mobile: { width: '100%' },
                }),
            ),
          }),
        ],
        { style: { ...wash, paddingY: 'space:24' } },
      );
    case 'display':
      return band(
        'root',
        look,
        tone,
        [
          node('copy', 'stack', {
            style: { base: { align: 'center', textAlign: 'center', gap: 'space:8' } },
            children: kids(
              kicker('kicker', look, tone),
              node('headline-wrap', 'box', {
                style: { base: { maxWidth: 'container:lg' } },
                children: [heading(true)],
              }),
              sub({ textAlign: 'center' }),
              action(true),
              image &&
                frame('media', look, 'image', {
                  ratio: '21/9',
                  style: { width: '100%', marginTop: 'space:8', shadow: 'shadow:lg' },
                  mobile: { marginTop: 'space:4' },
                }),
            ),
          }),
        ],
        { container: 'xl', style: { ...wash, paddingY: 'space:24' } },
      );
    case 'editorial':
      return band(
        'root',
        look,
        tone,
        [
          node('copy', 'stack', {
            style: { base: { gap: 'space:8' }, mobile: { gap: 'space:6' } },
            children: kids(
              node('headline-wrap', 'box', {
                style: { base: { maxWidth: 'container:lg' } },
                children: [heading(false)],
              }),
              node('rule', 'divider', {
                style: {
                  base: { borderColor: isLoud(tone) ? 'color:onPrimary/30' : 'color:text' },
                },
              }),
              sub(),
              action(),
              image &&
                frame('media', look, 'image', {
                  ratio: '21/9',
                  style: { width: '100%', marginTop: 'space:4' },
                  mobile: { aspectRatio: '4/3' },
                }),
            ),
          }),
        ],
        { style: { paddingY: 'space:20' } },
      );
    case 'portrait':
      return band(
        'root',
        look,
        tone,
        [
          node('card', 'stack', {
            style: {
              base: {
                direction: 'row',
                align: 'center',
                gap: 'space:12',
                padding: 'space:12',
                radius: 'radius:lg',
                background: isLoud(tone)
                  ? 'color:onPrimary/10'
                  : tone === 'surface'
                    ? 'color:bg'
                    : 'color:surface',
                backgroundGradient: isLoud(tone)
                  ? { from: 'color:onPrimary/10', to: 'color:onPrimary/5', angle: 135 }
                  : { from: 'color:primary/12', to: 'color:accent/15', angle: 135 },
              },
              mobile: {
                direction: 'column',
                padding: 'space:6',
                gap: 'space:6',
                textAlign: 'center',
              },
            },
            children: kids(
              image &&
                frame('media', look, 'image', {
                  ratio: '1/1',
                  radius: 'radius:full',
                  style: {
                    width: '15rem',
                    minWidth: '15rem',
                    shadow: 'shadow:lg',
                    borderWidth: '6px',
                    borderStyle: 'solid',
                    borderColor: 'color:bg',
                  },
                  mobile: { width: '10rem', minWidth: '10rem' },
                }),
              node('copy', 'stack', {
                style: { base: { gap: 'space:5', grow: true }, mobile: { align: 'center' } },
                children: kids(kicker('kicker', look, tone), heading(false), sub(), action()),
              }),
            ),
          }),
        ],
        { style: { paddingY: 'space:16' } },
      );
    case 'panel': {
      const quiet = !isLoud(tone);
      return band(
        'root',
        look,
        'bg',
        [
          node('panel', 'stack', {
            style: {
              base: {
                ...(quiet
                  ? {
                      background: 'color:surface',
                      backgroundGradient: {
                        from: 'color:primary/15',
                        via: 'color:surface',
                        to: 'color:accent/20',
                        angle: 135,
                      },
                      color: 'color:text',
                    }
                  : toneStyle(tone)),
                direction: look.mirror ? 'row-reverse' : 'row',
                align: 'center',
                gap: 'space:12',
                padding: 'space:16',
                radius: look.radius === '0' ? '0' : 'radius:lg',
                overflow: 'hidden',
              },
              tablet: { padding: 'space:10', gap: 'space:8' },
              mobile: { direction: 'column', align: 'stretch', padding: 'space:6' },
            },
            children: kids(
              node('copy', 'stack', {
                style: {
                  base: { gap: 'space:6', grow: true, width: '50%' },
                  mobile: { width: '100%' },
                },
                children: kids(kicker('kicker', look, tone), heading(false), sub(), action()),
              }),
              image &&
                frame('media', look, 'image', {
                  ratio: '1/1',
                  style: { width: '40%', shadow: 'shadow:lg' },
                  mobile: { width: '100%', aspectRatio: '4/3' },
                }),
            ),
          }),
        ],
        { tight: true },
      );
    }
    case 'statement':
      return band(
        'root',
        look,
        tone,
        [
          node('copy', 'stack', {
            style: { base: { gap: 'space:12' }, mobile: { gap: 'space:8' } },
            children: kids(
              kicker('kicker', look, tone),
              title('headline', look, {
                bind: 'headline',
                level: 1,
                type: 'type:4xl',
                style: {
                  fontWeight: look.titles.weight ?? 800,
                  maxWidth: 'container:lg',
                },
              }),
              node('row', 'stack', {
                style: {
                  base: { direction: 'row', align: 'end', gap: 'space:12' },
                  mobile: { direction: 'column', align: 'stretch', gap: 'space:8' },
                },
                children: kids(
                  node('aside', 'stack', {
                    style: {
                      base: { gap: 'space:6', width: '34%', minWidth: '16rem' },
                      mobile: { width: '100%', minWidth: '0' },
                    },
                    children: kids(sub(), action()),
                  }),
                  image &&
                    frame('media', look, 'image', {
                      ratio: '16/9',
                      style: { grow: true },
                      mobile: { width: '100%' },
                    }),
                ),
              }),
            ),
          }),
        ],
        { style: { ...wash, paddingY: 'space:20' } },
      );
    case 'fullbleed':
      return node('root', 'stack', {
        style: { base: toneStyle(tone) },
        children: kids(
          band(
            'intro',
            look,
            tone,
            [
              node('copy', 'stack', {
                style: {
                  base: {
                    gap: 'space:6',
                    ...(look.titles.center
                      ? { align: 'center', textAlign: 'center' }
                      : { maxWidth: 'container:lg' }),
                  },
                },
                children: kids(
                  kicker('kicker', look, tone),
                  heading(look.titles.center),
                  sub(look.titles.center ? { textAlign: 'center' } : {}),
                  action(look.titles.center),
                ),
              }),
            ],
            { style: { paddingTop: 'space:20', paddingBottom: 'space:16' } },
          ),
          image &&
            frame('media', look, 'image', {
              ratio: '21/9',
              radius: '0',
              style: { width: '100%' },
              mobile: { aspectRatio: '4/3' },
            }),
        ),
      });
    case 'compact':
      return band(
        'root',
        look,
        tone,
        [
          node('row', 'stack', {
            style: {
              base: { direction: 'row', align: 'center', justify: 'between', gap: 'space:12' },
              mobile: { direction: 'column-reverse', align: 'start', gap: 'space:6' },
            },
            children: kids(
              node('copy', 'stack', {
                style: { base: { gap: 'space:4', maxWidth: 'container:md' } },
                children: kids(
                  kicker('kicker', look, tone),
                  title('headline', look, {
                    bind: 'headline',
                    level: 1,
                    type: 'type:3xl',
                  }),
                  sub({ type: 'type:lg' }),
                  action(),
                ),
              }),
              image &&
                frame('media', look, 'image', {
                  ratio: '1/1',
                  style: { width: '11rem', minWidth: '11rem' },
                  mobile: { width: '6rem', minWidth: '6rem' },
                }),
            ),
          }),
        ],
        { style: { paddingY: 'space:16' } },
      );
  }
};

const text: BlockRecipe = ({ look }, type) => {
  const headline = fieldOf(type, 'headline', 'string');
  const body = fieldOf(type, 'body', 'richtext');
  if (!body) return null;
  const tone: Tone = 'bg';
  const heading =
    headline &&
    title('headline', look, {
      bind: 'headline',
      level: 2,
      type: 'type:3xl',
      visibility: when('headline'),
    });
  const prose = node('body', 'richtext', {
    bind: 'body',
    style: { base: { type: 'type:lg', color: 'color:text' }, mobile: { type: 'type:base' } },
  });
  switch (look.text) {
    case 'ruled':
      return band(
        'root',
        look,
        tone,
        [
          node('rule', 'divider', {
            style: { base: { borderColor: 'color:text', marginBottom: 'space:8' } },
          }),
          node('row', 'stack', {
            style: {
              base: { direction: 'row', align: 'start', gap: 'space:12' },
              mobile: { direction: 'column', gap: 'space:4' },
            },
            children: kids(
              headline &&
                node('aside', 'box', {
                  style: { base: { width: '30%' }, mobile: { width: '100%' } },
                  visibility: when('headline'),
                  children: [
                    title('headline', look, {
                      bind: 'headline',
                      level: 2,
                      type: 'type:xl',
                      style: { textTransform: 'uppercase' },
                    }),
                  ],
                }),
              node('main', 'box', {
                style: { base: { grow: true, maxWidth: 'container:sm' } },
                children: [prose],
              }),
            ),
          }),
        ],
        { tight: true },
      );
    case 'split':
      return band(
        'root',
        look,
        tone,
        [
          node('row', 'stack', {
            style: {
              base: { direction: 'row', align: 'start', gap: 'space:16' },
              tablet: { gap: 'space:10' },
              mobile: { direction: 'column', gap: 'space:6' },
            },
            children: kids(
              headline &&
                node('aside', 'stack', {
                  style: { base: { gap: 'space:4', width: '36%' }, mobile: { width: '100%' } },
                  visibility: when('headline'),
                  children: kids(kicker('kicker', look, tone), heading),
                }),
              node('main', 'box', {
                style: { base: { grow: true, maxWidth: 'container:sm' } },
                children: [prose],
              }),
            ),
          }),
        ],
        { tight: true },
      );
    case 'stacked':
    case 'centered': {
      const center = look.text === 'centered';
      return band(
        'root',
        look,
        tone,
        [
          node('copy', 'stack', {
            style: {
              base: {
                gap: 'space:6',
                maxWidth: `container:${look.reading}`,
                ...(center ? { marginX: 'auto', align: 'center', textAlign: 'center' } : {}),
              },
            },
            children: kids(
              headline &&
                node('head', 'stack', {
                  style: { base: { gap: 'space:4', align: center ? 'center' : 'start' } },
                  visibility: when('headline'),
                  children: kids(kicker('kicker', look, tone), heading),
                }),
              prose,
            ),
          }),
        ],
        { tight: true },
      );
    }
  }
};

/** A card of the basic template: image, headline and text; the page grid places it. */
const teaser: BlockRecipe = ({ look }, type) => {
  if (!hasFields(type, { headline: 'string' })) return null;
  const body = fieldOf(type, 'body', 'richtext', 'string');
  const image = fieldOf(type, 'image', 'asset');
  const tone: Tone = 'bg';
  const card = cardStyle(look, tone);
  return node('root', 'stack', {
    style: { ...card, base: { ...card.base, overflow: 'hidden', height: '100%' } },
    children: kids(
      cardBar('bar', look, tone),
      image &&
        frame('media', look, 'image', {
          ratio: look.card === 'plain' ? look.media : '16/9',
          radius: look.card === 'plain' ? look.radius : '0',
          visibility: when('image'),
        }),
      node('content', 'stack', {
        style: cardPadding(look, tone),
        children: kids(
          kicker('kicker', look, tone),
          title('headline', look, { bind: 'headline', level: 2, type: 'type:2xl' }),
          body &&
            node('body', body.type === 'richtext' ? 'richtext' : 'text', {
              bind: 'body',
              style: { base: { color: 'color:muted' } },
            }),
        ),
      }),
    ),
  });
};

interface ListOptions {
  image?: string;
  meta?: string[];
  more: boolean;
  columns?: number;
}

/** Title, facts, summary and the "learn more" line of a linked document. */
function entryText(
  recipe: Recipe,
  list: string,
  tone: Tone,
  options: ListOptions,
  size: `type:${string}`,
): Array<DesignNode | false> {
  const { look } = recipe;
  return [
    node('card-title', 'heading', {
      bind: `${list}.$item`,
      props: { level: 3 },
      style: {
        base: {
          type: size,
          ...(look.titles.weight ? { fontWeight: look.titles.weight } : {}),
          ...(look.titles.italic ? { fontStyle: 'italic' } : {}),
        },
      },
    }),
    ...(options.meta ?? []).map((field, index) =>
      node(`card-meta-${index + 1}`, 'text', {
        bind: `${list}.${field}`,
        style: {
          base: {
            type: 'type:sm',
            color: index === 0 ? (isLoud(tone) ? inkOf(tone) : 'color:primary') : softText(tone),
            fontWeight: index === 0 ? 600 : 400,
          },
        },
        visibility: when(`${list}.${field}`),
      }),
    ),
    node('card-summary', 'text', {
      bind: `${list}.summary`,
      style: { base: { color: softText(tone) } },
      visibility: when(`${list}.summary`),
    }),
    options.more &&
      node('card-more', 'stack', {
        style: {
          base: {
            direction: 'row',
            align: 'center',
            gap: 'space:2',
            marginTop: 'auto',
            paddingTop: 'space:2',
            fontWeight: 600,
            type: 'type:sm',
            color: isLoud(tone) ? inkOf(tone) : 'color:primary',
          },
        },
        children: [
          node('card-more-label', 'text', {
            props: {
              as: 'span',
              text: say(recipe, { en: 'Learn more', de: 'Mehr erfahren' }),
            },
          }),
          arrow('card-more-icon', tone),
        ],
      }),
  ];
}

/** A line between rows of a list. */
const rowRule = (id: string, tone: Tone): DesignNode =>
  node(id, 'divider', {
    style: { base: { borderColor: isLoud(tone) ? 'color:onPrimary/25' : 'color:border' } },
  });

/** Picked documents as a card grid, as rows beside their image, or as a text index. */
function linkedCards(
  recipe: Recipe,
  type: PresetType,
  list: string,
  tone: Tone,
  options: ListOptions,
): DesignNode {
  const { look } = recipe;
  const item = `${list}.$item`;
  const imagePath = options.image ? `${list}.${options.image}` : null;
  const head =
    fieldOf(type, 'headline', 'string') && sectionHead('section', look, tone, 'headline');

  if (look.list !== 'grid') {
    const rows = look.list === 'rows';
    const entry = node('card', 'link', {
      bind: item,
      style: {
        base: {
          ...plainLink(tone),
          display: 'flex',
          direction: 'row',
          align: rows ? 'center' : 'start',
          gap: rows ? 'space:10' : 'space:8',
          paddingY: rows ? 'space:8' : 'space:6',
        },
        hover: { color: isLoud(tone) ? inkOf(tone) : 'color:primary' },
        mobile: { direction: 'column', align: 'stretch', gap: 'space:4' },
      },
      children: kids(
        rows &&
          imagePath !== null &&
          frame('card-media', look, imagePath, {
            style: { width: '34%', minWidth: '14rem' },
            mobile: { width: '100%', minWidth: '0' },
            hover: { opacity: 0.92 },
          }),
        node('card-body', 'stack', {
          style: { base: { gap: 'space:2', grow: true } },
          children: kids(
            ...entryText(
              recipe,
              list,
              tone,
              { ...options, more: rows && options.more },
              rows ? 'type:2xl' : 'type:xl',
            ),
          ),
        }),
        !rows && arrow('card-arrow', tone),
      ),
    });
    return band(
      'root',
      look,
      tone,
      kids(
        head,
        node('list', 'repeat', {
          bind: list,
          style: { base: { display: 'flex', direction: 'column', gap: '0' } },
          children: [
            node('entry', 'stack', {
              children: [rowRule('row-rule', tone), entry],
            }),
          ],
        }),
        rowRule('list-end', tone),
      ),
    );
  }

  const card = cardStyle(look, tone);
  return band(
    'root',
    look,
    tone,
    kids(
      head,
      node('list', 'repeat', {
        bind: list,
        style: gridStyle(
          options.columns ?? look.columns,
          look.card === 'plain' ? 'space:10' : 'space:6',
        ),
        children: [
          node('card', 'link', {
            bind: item,
            style: {
              ...card,
              base: {
                ...card.base,
                ...plainLink(tone),
                display: 'flex',
                direction: 'column',
                overflow: 'hidden',
                height: '100%',
              },
            },
            children: kids(
              cardBar('card-bar', look, tone),
              imagePath !== null &&
                frame('card-media', look, imagePath, {
                  radius: look.card === 'plain' ? look.radius : '0',
                  hover: { opacity: 0.92 },
                }),
              node('card-body', 'stack', {
                style: {
                  ...cardPadding(look, tone),
                  base: { ...cardPadding(look, tone).base, grow: true },
                },
                children: kids(...entryText(recipe, list, tone, options, 'type:xl')),
              }),
            ),
          }),
        ],
      }),
    ),
  );
}

const serviceList: BlockRecipe = (recipe, type) => {
  if (!hasFields(type, { services: 'content' })) return null;
  return linkedCards(recipe, type, 'services', 'bg', { image: 'image', more: true, columns: 3 });
};

const projectGrid: BlockRecipe = (recipe, type) => {
  if (!hasFields(type, { projects: 'content' })) return null;
  return linkedCards(recipe, type, 'projects', 'bg', {
    image: 'cover',
    meta: ['client', 'role'],
    more: false,
    columns: recipe.look.columns === 3 ? 3 : 2,
  });
};

const team: BlockRecipe = ({ look }, type) => {
  if (!hasFields(type, { members: 'content' })) return null;
  const tone = look.alternate;
  const card = cardStyle(look, tone);
  const round = look.portraits === 'round';
  return band(
    'root',
    look,
    tone,
    kids(
      fieldOf(type, 'headline', 'string') && sectionHead('section', look, tone, 'headline'),
      node('list', 'repeat', {
        bind: 'members',
        style: gridStyle(look.columns === 3 ? 4 : 3, 'space:6'),
        children: [
          node('member', 'stack', {
            style: { ...card, base: { ...card.base, overflow: 'hidden' } },
            children: kids(
              cardBar('member-bar', look, tone),
              frame('photo', look, 'members.photo', {
                ratio: round ? '1/1' : '3/4',
                radius: round ? 'radius:full' : look.card === 'plain' ? look.radius : '0',
                ...(round
                  ? { style: { width: '8rem', marginTop: 'space:6', marginX: 'auto' } }
                  : {}),
              }),
              node('member-body', 'stack', {
                style: {
                  ...cardPadding(look, tone),
                  base: {
                    ...cardPadding(look, tone).base,
                    gap: 'space:1',
                    ...(round ? { textAlign: 'center', align: 'center' } : {}),
                  },
                },
                children: [
                  node('name', 'heading', {
                    bind: 'members.$item',
                    props: { level: 3 },
                    style: { base: { type: 'type:lg', fontWeight: 700 } },
                  }),
                  node('role', 'text', {
                    bind: 'members.role',
                    style: {
                      base: {
                        type: 'type:sm',
                        fontWeight: 600,
                        color: isLoud(tone) ? inkOf(tone) : 'color:primary',
                      },
                    },
                    visibility: when('members.role'),
                  }),
                  node('bio', 'text', {
                    bind: 'members.bio',
                    style: {
                      base: { type: 'type:sm', color: softText(tone), marginTop: 'space:2' },
                    },
                    visibility: when('members.bio'),
                  }),
                ],
              }),
            ),
          }),
        ],
      }),
    ),
  );
};

/** Name and role under a quote. */
function quotePerson(tone: Tone, center = false): DesignNode {
  return node('person', 'stack', {
    props: { as: 'figcaption' },
    style: {
      base: {
        gap: 'space:1',
        marginTop: 'auto',
        ...(center ? { align: 'center', textAlign: 'center' } : {}),
      },
    },
    children: [
      node('name', 'text', {
        bind: 'items.$item',
        props: { as: 'strong' },
        style: { base: { fontWeight: 700 } },
      }),
      node('role', 'text', {
        bind: 'items.role',
        props: { as: 'span' },
        style: { base: { type: 'type:sm', color: softText(tone) } },
        visibility: when('items.role'),
      }),
    ],
  });
}

const testimonials: BlockRecipe = ({ look }, type) => {
  if (!hasFields(type, { items: 'content' })) return null;
  const tone =
    look.quote === 'cards' ? look.alternate : look.quote === 'large' ? look.highlight : 'bg';
  const loud = isLoud(tone);
  const markColor = loud ? inkOf(tone) : 'color:accent';
  const head =
    fieldOf(type, 'headline', 'string') &&
    sectionHead('section', look, tone, 'headline', {
      center: look.quote !== 'bar' || look.titles.center,
    });
  const quoteText = (size: `type:${string}`, mobile: `type:${string}`, center = false) =>
    node('quote', 'text', {
      bind: 'items.quote',
      props: { as: 'blockquote' },
      style: {
        base: {
          type: size,
          font: 'font:heading',
          fontWeight: 500,
          ...(look.titles.italic ? { fontStyle: 'italic' } : {}),
          ...(center ? { textAlign: 'center' } : {}),
        },
        mobile: { type: mobile },
      },
    });

  switch (look.quote) {
    case 'large':
      return band(
        'root',
        look,
        tone,
        kids(
          head,
          node('list', 'repeat', {
            bind: 'items',
            style: { base: { display: 'flex', direction: 'column', gap: 'space:16' } },
            children: [
              node('quote-card', 'stack', {
                props: { as: 'figure' },
                style: {
                  base: {
                    gap: 'space:6',
                    align: 'center',
                    maxWidth: 'container:md',
                    marginX: 'auto',
                  },
                },
                children: [
                  node('mark', 'text', {
                    props: { as: 'span', text: { en: '“' } },
                    style: {
                      base: {
                        type: 'type:4xl',
                        font: 'font:heading',
                        fontWeight: 800,
                        height: '2.5rem',
                        color: markColor,
                      },
                    },
                  }),
                  quoteText('type:3xl', 'type:xl', true),
                  quotePerson(tone, true),
                ],
              }),
            ],
          }),
        ),
      );
    case 'bar':
      return band(
        'root',
        look,
        tone,
        kids(
          head,
          node('list', 'repeat', {
            bind: 'items',
            style: gridStyle(2, 'space:12'),
            children: [
              node('quote-card', 'stack', {
                props: { as: 'figure' },
                style: { base: { direction: 'row', gap: 'space:6', align: 'stretch' } },
                children: [
                  node('accent', 'box', {
                    style: {
                      base: {
                        width: '0.3rem',
                        minWidth: '0.3rem',
                        radius: look.radius === '0' ? '0' : 'radius:full',
                        background: 'color:primary',
                        backgroundGradient: {
                          from: 'color:primary',
                          to: 'color:accent',
                          angle: 180,
                        },
                      },
                    },
                  }),
                  node('quote-body', 'stack', {
                    style: { base: { gap: 'space:5', grow: true } },
                    children: [quoteText('type:xl', 'type:lg'), quotePerson(tone)],
                  }),
                ],
              }),
            ],
          }),
        ),
      );
    case 'cards': {
      const card = cardStyle(look, tone);
      return band(
        'root',
        look,
        tone,
        kids(
          head,
          node('list', 'repeat', {
            bind: 'items',
            style: gridStyle(2, 'space:6'),
            children: [
              node('quote-card', 'stack', {
                props: { as: 'figure' },
                style: {
                  ...card,
                  base: { ...card.base, gap: 'space:5', padding: 'space:8' },
                  mobile: { padding: 'space:6' },
                },
                children: [
                  node('mark', 'text', {
                    props: { as: 'span', text: { en: '“' } },
                    style: {
                      base: {
                        type: 'type:4xl',
                        font: 'font:heading',
                        fontWeight: 800,
                        height: '2.5rem',
                        color: markColor,
                      },
                    },
                  }),
                  quoteText('type:xl', 'type:lg'),
                  quotePerson(tone),
                ],
              }),
            ],
          }),
        ),
      );
    }
  }
};

const callToAction: BlockRecipe = ({ look }, type) => {
  if (!hasFields(type, { headline: 'string' })) return null;
  const textField = fieldOf(type, 'text', 'string', 'richtext');
  const button = fieldOf(type, 'button', 'link');
  const tone: Tone = look.cta === 'outline' ? 'bg' : look.highlight;
  const loud = isLoud(tone);
  const center = look.titles.center || look.cta === 'outline';
  const copy = node('copy', 'stack', {
    style: {
      base: {
        gap: 'space:4',
        ...(center ? { align: 'center', textAlign: 'center' } : { grow: true }),
      },
    },
    children: kids(
      title('headline', look, {
        bind: 'headline',
        level: 2,
        type: 'type:3xl',
        style: { maxWidth: 'container:md' },
      }),
      textField &&
        node('text', textField.type === 'richtext' ? 'richtext' : 'text', {
          bind: 'text',
          style: {
            base: { type: 'type:lg', color: softText(loud ? tone : 'surface'), maxWidth: '36rem' },
          },
          visibility: when('text'),
        }),
    ),
  });
  const action =
    button &&
    node('button', 'button', {
      bind: 'button',
      props: { variant: loud ? 'secondary' : 'primary' },
      style: { base: { paddingX: 'space:8', paddingY: 'space:4', type: 'type:lg' } },
      visibility: when('button'),
    });
  const inner = node('inner', 'stack', {
    style: {
      base: center
        ? { align: 'center', gap: 'space:8' }
        : { direction: 'row', align: 'center', justify: 'between', gap: 'space:10' },
      mobile: { direction: 'column', align: center ? 'center' : 'start', gap: 'space:6' },
    },
    children: kids(copy, action),
  });
  const rounded = look.radius === '0' ? '0' : 'radius:lg';
  switch (look.cta) {
    case 'band':
      return band('root', look, tone, [inner]);
    case 'outline':
      return band('root', look, 'bg', [
        node('panel', 'box', {
          style: {
            base: {
              padding: 'space:16',
              radius: look.radius,
              borderWidth: '2px',
              borderStyle: 'solid',
              borderColor: 'color:text',
            },
            mobile: { padding: 'space:8' },
          },
          children: [inner],
        }),
      ]);
    case 'panel':
      return band('root', look, 'bg', [
        node('panel', 'box', {
          style: {
            base: {
              padding: 'space:16',
              radius: rounded,
              ...(loud
                ? toneStyle(tone)
                : {
                    background: 'color:surface',
                    backgroundGradient: {
                      from: 'color:primary/15',
                      to: 'color:accent/20',
                      angle: 120,
                    },
                  }),
            },
            mobile: { padding: 'space:8' },
          },
          children: [inner],
        }),
      ]);
  }
};

/** Text beside a picture; the picture sits opposite the hero's, for a zigzag down the page. */
const mediaText: BlockRecipe = ({ look }, type) => {
  if (!hasFields(type, { headline: 'string' })) return null;
  const body = fieldOf(type, 'body', 'richtext');
  const image = fieldOf(type, 'image', 'asset');
  const button = fieldOf(type, 'button', 'link');
  const tone: Tone = 'bg';
  const imageFirst = !look.mirror;
  return band('root', look, tone, [
    node('row', 'stack', {
      style: {
        base: {
          direction: imageFirst ? 'row' : 'row-reverse',
          align: 'center',
          gap: 'space:16',
        },
        tablet: { gap: 'space:10' },
        mobile: { direction: 'column', align: 'stretch', gap: 'space:8' },
      },
      children: kids(
        image &&
          frame('media', look, 'image', {
            ratio: look.media === '3/4' ? '3/4' : '4/3',
            style: {
              width: '46%',
              ...(look.card === 'elevated' || look.card === 'outlined'
                ? { shadow: 'shadow:lg' }
                : {}),
            },
            mobile: { width: '100%' },
          }),
        node('copy', 'stack', {
          style: { base: { gap: 'space:5', grow: true, width: '50%' }, mobile: { width: '100%' } },
          children: kids(
            kicker('kicker', look, tone),
            title('headline', look, { bind: 'headline', level: 2, type: 'type:3xl' }),
            body &&
              node('body', 'richtext', {
                bind: 'body',
                style: {
                  base: { type: 'type:lg', color: 'color:muted' },
                  mobile: { type: 'type:base' },
                },
                visibility: when('body'),
              }),
            button &&
              node('button', 'button', {
                bind: 'button',
                props: { variant: 'primary' },
                style: { base: { alignSelf: 'start', marginTop: 'space:2' } },
                visibility: when('button'),
              }),
          ),
        }),
      ),
    }),
  ]);
};

/** One large picture: edge to edge in image-led looks, else in the container. */
const imageBlock: BlockRecipe = ({ look }, type) => {
  if (!hasFields(type, { image: 'asset' })) return null;
  const caption = fieldOf(type, 'caption', 'string');
  const wide = look.hero === 'fullbleed';
  const captionNode =
    caption &&
    node('caption', 'text', {
      bind: 'caption',
      props: { as: 'p' },
      style: {
        base: {
          type: 'type:sm',
          color: 'color:muted',
          marginTop: 'space:3',
          ...(look.titles.center ? { textAlign: 'center' } : {}),
          ...(look.titles.italic ? { fontStyle: 'italic' } : {}),
        },
      },
      visibility: when('caption'),
    });
  if (wide)
    return node('root', 'stack', {
      props: { as: 'figure' },
      style: {
        base: { paddingY: look.rhythm.tight[0] },
        mobile: { paddingY: look.rhythm.tight[1] },
      },
      children: kids(
        frame('media', look, 'image', {
          ratio: '21/9',
          radius: '0',
          style: { width: '100%' },
          mobile: { aspectRatio: '4/3' },
        }),
        captionNode && node('caption-band', 'section', { children: [captionNode] }),
      ),
    });
  return band(
    'root',
    look,
    'bg',
    [
      node('figure', 'stack', {
        props: { as: 'figure' },
        children: kids(
          frame('media', look, 'image', {
            ratio: '16/9',
            style: { width: '100%' },
            mobile: { aspectRatio: '4/3' },
          }),
          captionNode,
        ),
      }),
    ],
    { tight: true },
  );
};

const gallery: BlockRecipe = ({ look }, type) => {
  const images = fieldOf(type, 'images', 'asset');
  if (!images) return null;
  const tone: Tone = look.alternate === 'surface' && look.card !== 'plain' ? 'surface' : 'bg';
  const tall = look.media === '3/4';
  return band(
    'root',
    look,
    tone,
    kids(
      fieldOf(type, 'headline', 'string') && sectionHead('section', look, tone, 'headline'),
      node('grid', 'repeat', {
        bind: 'images',
        style: gridStyle(
          look.columns === 2 ? 2 : tall ? 3 : 4,
          look.card === 'plain' ? 'space:3' : 'space:4',
        ),
        children: [
          frame('shot', look, 'images.$item', {
            ratio: tall ? '3/4' : look.media === '1/1' ? '1/1' : '4/3',
            hover: { opacity: 0.9 },
          }),
        ],
      }),
    ),
    // No placeholder frames without pictures, so an empty gallery stays hidden.
    { visibility: when('images') },
  );
};

/** One quote, laid out like the look's testimonials. */
const quote: BlockRecipe = ({ look }, type) => {
  if (!hasFields(type, { quote: 'string' })) return null;
  const author = fieldOf(type, 'author', 'string');
  const role = fieldOf(type, 'role', 'string');
  const tone: Tone =
    look.quote === 'large' ? look.highlight : look.quote === 'cards' ? look.alternate : 'bg';
  const loud = isLoud(tone);
  const center = look.quote !== 'bar';
  const person = node('person', 'stack', {
    props: { as: 'figcaption' },
    style: {
      base: { gap: 'space:1', ...(center ? { align: 'center', textAlign: 'center' } : {}) },
    },
    children: kids(
      author &&
        node('author', 'text', {
          bind: 'author',
          props: { as: 'strong' },
          style: { base: { fontWeight: 700 } },
          visibility: when('author'),
        }),
      role &&
        node('role', 'text', {
          bind: 'role',
          props: { as: 'span' },
          style: { base: { type: 'type:sm', color: softText(tone) } },
          visibility: when('role'),
        }),
    ),
  });
  const text = node('quote', 'text', {
    bind: 'quote',
    props: { as: 'blockquote' },
    style: {
      base: {
        type: look.quote === 'large' ? 'type:3xl' : 'type:2xl',
        font: 'font:heading',
        fontWeight: 500,
        ...(look.titles.italic ? { fontStyle: 'italic' } : {}),
        ...(center ? { textAlign: 'center' } : {}),
      },
      mobile: { type: 'type:xl' },
    },
  });
  const mark = node('mark', 'icon', {
    props: { name: 'quote' },
    style: {
      base: { color: loud ? inkOf(tone) : 'color:accent', width: '2.5rem', height: '2.5rem' },
    },
  });
  if (look.quote === 'bar')
    return band('root', look, tone, [
      node('figure', 'stack', {
        props: { as: 'figure' },
        style: {
          base: { direction: 'row', gap: 'space:8', align: 'stretch', maxWidth: 'container:md' },
          mobile: { gap: 'space:5' },
        },
        children: [
          node('accent', 'box', {
            style: {
              base: {
                width: '0.35rem',
                minWidth: '0.35rem',
                radius: look.radius === '0' ? '0' : 'radius:full',
                background: 'color:primary',
                backgroundGradient: { from: 'color:primary', to: 'color:accent', angle: 180 },
              },
            },
          }),
          node('body', 'stack', {
            style: { base: { gap: 'space:6' } },
            children: [text, person],
          }),
        ],
      }),
    ]);
  const card = look.quote === 'cards' ? cardStyle(look, tone) : { base: {} };
  return band('root', look, tone, [
    node('figure', 'stack', {
      props: { as: 'figure' },
      style: {
        ...card,
        base: {
          ...card.base,
          gap: 'space:6',
          align: 'center',
          maxWidth: 'container:md',
          marginX: 'auto',
          ...(look.quote === 'cards' ? { padding: 'space:12' } : {}),
        },
        mobile: { padding: look.quote === 'cards' ? 'space:6' : '0' },
      },
      children: [mark, text, person],
    }),
  ]);
};

/** A section heading with an intro sentence under it. */
function introHead(
  look: Look,
  tone: Tone,
  type: PresetType,
  options: { center?: boolean } = {},
): DesignNode | null {
  const headline = fieldOf(type, 'headline', 'string');
  const intro = fieldOf(type, 'intro', 'string');
  if (!headline && !intro) return null;
  const center = options.center ?? look.titles.center;
  return node('head', 'stack', {
    style: {
      base: {
        gap: 'space:4',
        marginBottom: 'space:10',
        ...(center ? { align: 'center', textAlign: 'center' } : {}),
      },
      mobile: { marginBottom: 'space:8' },
    },
    children: kids(
      headline && sectionHead('section', look, tone, 'headline', { center, flush: true }),
      intro &&
        node('intro', 'text', {
          bind: 'intro',
          style: { base: { type: 'type:lg', color: softText(tone), maxWidth: 'container:sm' } },
          visibility: when('intro'),
        }),
    ),
  });
}

/** A small badge in front of a feature. */
function badge(id: string, look: Look, tone: Tone): DesignNode {
  const loud = isLoud(tone);
  return node(id, 'box', {
    style: {
      base: {
        display: 'flex',
        align: 'center',
        justify: 'center',
        width: '2.75rem',
        height: '2.75rem',
        minWidth: '2.75rem',
        radius: look.radius === '0' ? '0' : look.kicker === 'square' ? 'radius:sm' : 'radius:full',
        background: loud ? 'color:onPrimary/15' : 'color:primary/12',
        color: loud ? inkOf(tone) : 'color:primary',
      },
    },
    children: [node(`${id}-icon`, 'icon', { props: { name: 'check' } })],
  });
}

/** Points with a title and a sentence: cards in a grid, or rows in list looks. */
const features: BlockRecipe = ({ look }, type) => {
  if (!fieldOf(type, 'items', 'repeater')) return null;
  const tone = look.alternate;
  const head = kids(introHead(look, tone, type));
  const itemTitle = title('item-title', look, {
    bind: 'items.title',
    level: 3,
    type: 'type:xl',
    style: { textTransform: 'none' },
  });
  const itemText = node('item-text', 'text', {
    bind: 'items.text',
    style: { base: { color: softText(tone) } },
    visibility: when('items.text'),
  });
  if (look.list !== 'grid')
    return band(
      'root',
      look,
      tone,
      kids(
        ...head,
        node('list', 'repeat', {
          bind: 'items',
          style: { base: { display: 'flex', direction: 'column', gap: '0' } },
          children: [
            node('item', 'stack', {
              children: [
                rowRule('item-rule', tone),
                node('item-row', 'stack', {
                  style: {
                    base: { direction: 'row', gap: 'space:8', paddingY: 'space:6', align: 'start' },
                    mobile: { direction: 'column', gap: 'space:2' },
                  },
                  children: [
                    node('item-head', 'stack', {
                      style: {
                        base: { direction: 'row', gap: 'space:4', align: 'center', width: '36%' },
                        mobile: { width: '100%' },
                      },
                      children: [badge('item-badge', look, tone), itemTitle],
                    }),
                    node('item-body', 'box', {
                      style: { base: { grow: true } },
                      children: [itemText],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
        rowRule('list-end', tone),
      ),
    );
  const card = cardStyle(look, tone);
  return band(
    'root',
    look,
    tone,
    kids(
      ...head,
      node('list', 'repeat', {
        bind: 'items',
        style: gridStyle(look.columns, 'space:6'),
        children: [
          node('item', 'stack', {
            style: { ...card, base: { ...card.base, overflow: 'hidden', height: '100%' } },
            children: kids(
              cardBar('item-bar', look, tone),
              node('item-body', 'stack', {
                style: {
                  ...cardPadding(look, tone),
                  base: {
                    ...cardPadding(look, tone).base,
                    gap: 'space:3',
                    ...(look.titles.center ? { align: 'center', textAlign: 'center' } : {}),
                  },
                },
                children: [badge('item-badge', look, tone), itemTitle, itemText],
              }),
            ),
          }),
        ],
      }),
    ),
  );
};

/** Key figures, large, in the heading font. */
const stats: BlockRecipe = ({ look }, type) => {
  if (!fieldOf(type, 'items', 'repeater')) return null;
  const tone: Tone = isLoud(look.highlight) ? look.highlight : look.alternate;
  const loud = isLoud(tone);
  return band(
    'root',
    look,
    tone,
    kids(
      fieldOf(type, 'headline', 'string') && sectionHead('section', look, tone, 'headline'),
      node('list', 'repeat', {
        bind: 'items',
        style: {
          base: { display: 'grid', columns: 3, gap: 'space:8' },
          mobile: { columns: 1, gap: 'space:6' },
        },
        children: [
          node('item', 'stack', {
            style: {
              base: {
                gap: 'space:2',
                ...(look.titles.center ? { align: 'center', textAlign: 'center' } : {}),
              },
            },
            children: kids(
              look.kicker === 'rule' && rowRule('item-rule', tone),
              node('value', 'text', {
                bind: 'items.value',
                style: {
                  base: {
                    type: 'type:4xl',
                    font: 'font:heading',
                    fontWeight: look.titles.weight ?? 800,
                    color: loud ? inkOf(tone) : 'color:primary',
                    ...(look.titles.italic ? { fontStyle: 'italic' } : {}),
                  },
                },
              }),
              node('label', 'text', {
                bind: 'items.label',
                style: {
                  base: {
                    type: 'type:sm',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    color: softText(tone),
                  },
                },
              }),
            ),
          }),
        ],
      }),
    ),
    { tight: true },
  );
};

/** Questions and answers under a rule each; the heading beside them in split looks. */
const faq: BlockRecipe = ({ look }, type) => {
  if (!fieldOf(type, 'items', 'repeater')) return null;
  const tone: Tone = 'bg';
  const split = look.text === 'split' || look.text === 'ruled';
  const headline = fieldOf(type, 'headline', 'string');
  const list = node('list', 'repeat', {
    bind: 'items',
    style: { base: { display: 'flex', direction: 'column', gap: '0' } },
    children: [
      node('item', 'stack', {
        children: [
          rowRule('item-rule', tone),
          node('item-body', 'stack', {
            style: { base: { gap: 'space:2', paddingY: 'space:6' } },
            children: [
              node('question', 'heading', {
                bind: 'items.question',
                props: { level: 3 },
                style: {
                  base: {
                    type: 'type:lg',
                    fontWeight: 700,
                    ...(look.titles.italic ? { fontStyle: 'italic' } : {}),
                  },
                },
              }),
              node('answer', 'text', {
                bind: 'items.answer',
                style: { base: { color: 'color:muted' } },
                visibility: when('items.answer'),
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const listBox = node('list-box', 'stack', {
    style: {
      base: split ? { grow: true } : { maxWidth: 'container:md', marginX: 'auto', width: '100%' },
    },
    children: [list, rowRule('list-end', tone)],
  });
  if (split)
    return band('root', look, tone, [
      node('row', 'stack', {
        style: {
          base: { direction: 'row', gap: 'space:16', align: 'start' },
          mobile: { direction: 'column', gap: 'space:6' },
        },
        children: kids(
          headline &&
            node('aside', 'stack', {
              style: { base: { gap: 'space:4', width: '34%' }, mobile: { width: '100%' } },
              visibility: when('headline'),
              children: kids(
                kicker('kicker', look, tone),
                title('headline', look, { bind: 'headline', level: 2, type: 'type:3xl' }),
              ),
            }),
          listBox,
        ),
      }),
    ]);
  return band(
    'root',
    look,
    tone,
    kids(headline && sectionHead('section', look, tone, 'headline', { center: true }), listBox),
  );
};

/** Plans as cards: name, price, what is included and a button. */
const pricing: BlockRecipe = ({ look }, type) => {
  if (!fieldOf(type, 'plans', 'repeater')) return null;
  const tone = look.alternate;
  const card = cardStyle(look, tone);
  return band(
    'root',
    look,
    tone,
    kids(
      introHead(look, tone, type, { center: true }),
      node('plans', 'repeat', {
        bind: 'plans',
        style: gridStyle(3, 'space:6'),
        children: [
          node('plan', 'stack', {
            style: { ...card, base: { ...card.base, overflow: 'hidden', height: '100%' } },
            children: kids(
              cardBar('plan-bar', look, tone),
              node('plan-body', 'stack', {
                style: {
                  base: { gap: 'space:4', padding: 'space:8', grow: true },
                  mobile: { padding: 'space:6' },
                },
                children: [
                  node('name', 'heading', {
                    bind: 'plans.name',
                    props: { level: 3 },
                    style: {
                      base: {
                        type: 'type:sm',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: isLoud(tone) ? inkOf(tone) : 'color:primary',
                      },
                    },
                  }),
                  node('price-row', 'stack', {
                    style: {
                      base: { direction: 'row', align: 'baseline', gap: 'space:2', wrap: true },
                    },
                    children: [
                      node('price', 'text', {
                        bind: 'plans.price',
                        style: {
                          base: {
                            type: 'type:3xl',
                            font: 'font:heading',
                            fontWeight: look.titles.weight ?? 800,
                          },
                        },
                      }),
                      node('period', 'text', {
                        bind: 'plans.period',
                        style: { base: { type: 'type:sm', color: softText(tone) } },
                        visibility: when('plans.period'),
                      }),
                    ],
                  }),
                  rowRule('plan-rule', tone),
                  node('features', 'text', {
                    bind: 'plans.features',
                    style: { base: { color: softText(tone) } },
                    visibility: when('plans.features'),
                  }),
                  node('plan-button', 'button', {
                    bind: 'plans.button',
                    props: { variant: 'primary' },
                    style: { base: { marginTop: 'auto', alignSelf: 'stretch' } },
                    visibility: when('plans.button'),
                  }),
                ],
              }),
            ),
          }),
        ],
      }),
    ),
  );
};

/** A form beside its intro, on a card of the look. */
const contact: BlockRecipe = ({ look }, type) => {
  const form = type.fields.find((field) => field.type === 'databag');
  if (!form) return null;
  const tone: Tone = 'bg';
  const cardTone: Tone = look.alternate === 'surface' ? 'surface' : 'bg';
  const card = cardStyle(look, look.card === 'plain' ? tone : cardTone);
  const text = fieldOf(type, 'text', 'string');
  return band('root', look, tone, [
    node('row', 'stack', {
      style: {
        base: { direction: 'row', align: 'start', gap: 'space:16' },
        tablet: { gap: 'space:10' },
        mobile: { direction: 'column', gap: 'space:8' },
      },
      children: [
        node('copy', 'stack', {
          style: { base: { gap: 'space:4', width: '38%' }, mobile: { width: '100%' } },
          children: kids(
            kicker('kicker', look, tone),
            fieldOf(type, 'headline', 'string') &&
              title('headline', look, {
                bind: 'headline',
                level: 2,
                type: 'type:3xl',
                visibility: when('headline'),
              }),
            text &&
              node('text', 'text', {
                bind: 'text',
                style: { base: { type: 'type:lg', color: 'color:muted' } },
                visibility: when('text'),
              }),
          ),
        }),
        node('form-card', 'box', {
          style: {
            ...card,
            base: {
              ...card.base,
              grow: true,
              ...(look.card === 'plain' ? {} : { padding: 'space:8' }),
            },
            mobile: { padding: look.card === 'plain' ? '0' : 'space:5' },
          },
          children: kids(
            cardBar('form-bar', look, cardTone),
            node('form', 'form', {
              bind: form.name,
              style: { base: { gap: 'space:4' } },
              children: [
                node('form-input', 'formField'),
                node('form-submit', 'formSubmit', { style: { base: { alignSelf: 'start' } } }),
                node('form-message', 'formMessage'),
              ],
            }),
          ),
        }),
      ],
    }),
  ]);
};

const BLOCKS: Record<string, BlockRecipe> = {
  hero,
  text,
  teaser,
  'service-list': serviceList,
  'project-grid': projectGrid,
  team,
  testimonials,
  'call-to-action': callToAction,
  'media-text': mediaText,
  image: imageBlock,
  gallery,
  quote,
  features,
  stats,
  faq,
  pricing,
  contact,
};

/** Block types whose design is a full-width band rather than a card in a grid. */
export const BAND_BLOCKS = new Set(Object.keys(BLOCKS).filter((name) => name !== 'teaser'));

/** The design of a known block type, or `null` to keep the generated one. */
export function presetBlock(recipe: Recipe, type: PresetType): BlockDesign | null {
  const make = BLOCKS[type.name];
  const root = make?.(recipe, type) ?? null;
  return root ? { variants: { default: { label: 'Default', root } }, default: 'default' } : null;
}
