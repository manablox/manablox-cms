import type { DesignNode, LayoutDesign, MenuDesign, MenuLevelStyle, StyleProps } from '../types.js';
import { inkOf, isLoud, kids, node, type Recipe, say, softText, toneStyle } from './kit.js';

/** The header menu's machine name and the key of the footer menu design. */
export const MAIN_MENU = 'main';
export const FOOTER_MENU_DESIGN = 'footer';

function header(recipe: Recipe, menu: string): DesignNode {
  const { look } = recipe;
  const { kind, tone } = look.header;
  const logo = node('logo', 'logo', {
    props: { link: true },
    style: {
      base: {
        color: isLoud(tone) ? inkOf(tone) : 'color:text',
        textDecoration: 'none',
        type: 'type:xl',
        font: 'font:heading',
        fontWeight: 700,
        ...look.header.logo,
      },
      // A type step sets the weight too.
      mobile: { type: 'type:lg', fontWeight: look.header.logo.fontWeight ?? 700 },
    },
  });
  const nav = node('main-menu', 'menu', { props: { menu } });
  const locales = node('locales', 'localeSwitch', {
    style: { base: { type: 'type:sm', color: softText(tone) } },
  });
  const bar =
    kind === 'centered'
      ? node('header-bar', 'stack', {
          style: {
            base: { align: 'center', gap: 'space:4' },
            tablet: { direction: 'row', justify: 'between' },
          },
          children: [
            logo,
            node('header-nav', 'stack', {
              style: { base: { direction: 'row', align: 'center', gap: 'space:6' } },
              children: [nav, locales],
            }),
          ],
        })
      : node('header-bar', 'stack', {
          style: {
            base: { direction: 'row', align: 'center', justify: 'between', gap: 'space:8' },
          },
          children:
            kind === 'split'
              ? [
                  logo,
                  node('header-nav', 'box', {
                    style: { base: { display: 'flex', justify: 'center', grow: true } },
                    children: [nav],
                  }),
                  locales,
                ]
              : [
                  logo,
                  node('header-nav', 'stack', {
                    style: { base: { direction: 'row', align: 'center', gap: 'space:6' } },
                    children: [nav, locales],
                  }),
                ],
        });
  if (kind === 'floating')
    return node('header', 'section', {
      props: { as: 'header' },
      style: {
        base: { ...toneStyle('bg'), paddingY: 'space:4' },
        mobile: { paddingY: 'space:3' },
      },
      children: [
        node('header-panel', 'box', {
          style: {
            base: {
              ...toneStyle(tone === 'surface' ? 'bg' : tone),
              paddingX: 'space:6',
              paddingY: 'space:3',
              radius: look.radius === '0' ? '0' : 'radius:lg',
              shadow: 'shadow:md',
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: isLoud(tone) ? 'color:onPrimary/15' : 'color:border',
            },
            mobile: { paddingX: 'space:4' },
          },
          children: [bar],
        }),
      ],
    });
  return node('header', 'section', {
    props: { as: 'header' },
    style: {
      base: {
        ...toneStyle(tone),
        paddingY: kind === 'centered' ? 'space:8' : 'space:5',
      },
      tablet: { paddingY: 'space:4' },
    },
    children: [bar],
  });
}

function footer(recipe: Recipe, menu: string): DesignNode {
  const { look } = recipe;
  const { kind, tone } = look.footer;
  const soft = softText(tone);
  const links = node('footer-menu', 'menu', { props: { menu, design: FOOTER_MENU_DESIGN } });
  const name = node('footer-name', 'stack', {
    style: { base: { direction: 'row', gap: 'space:1', type: 'type:sm', color: soft } },
    children: [
      node('footer-copy', 'text', { props: { as: 'small', text: { en: '©' } } }),
      node('footer-site', 'text', { bind: '$site.name', props: { as: 'small' } }),
    ],
  });
  const rule = node('footer-rule', 'divider', {
    style: { base: { borderColor: isLoud(tone) ? 'color:onPrimary/20' : 'color:border' } },
  });
  const locales = node('footer-locales', 'localeSwitch', {
    style: { base: { type: 'type:sm', color: soft } },
  });
  const brand = node('footer-logo', 'logo', {
    props: { link: true },
    style: {
      base: {
        color: isLoud(tone) ? inkOf(tone) : 'color:text',
        textDecoration: 'none',
        type: kind === 'display' ? 'type:4xl' : 'type:xl',
        font: 'font:heading',
        fontWeight: kind === 'display' ? 800 : 700,
        ...look.header.logo,
      },
    },
  });
  const row = (id: string, children: DesignNode[], style: StyleProps = {}) =>
    node(id, 'stack', {
      style: {
        base: {
          direction: 'row',
          align: 'center',
          justify: 'between',
          gap: 'space:6',
          wrap: true,
          ...style,
        },
        mobile: { direction: 'column', align: 'start' },
      },
      children,
    });

  const children: DesignNode[] =
    kind === 'minimal'
      ? [row('footer-row', [brand, links, name])]
      : kind === 'centered'
        ? [
            node('footer-stack', 'stack', {
              style: { base: { align: 'center', gap: 'space:6', textAlign: 'center' } },
              children: [brand, links, locales, name],
            }),
          ]
        : kind === 'display'
          ? [
              node('footer-stack', 'stack', {
                style: { base: { gap: 'space:10' }, mobile: { gap: 'space:8' } },
                children: [
                  brand,
                  rule,
                  row('footer-row', [
                    links,
                    node('footer-meta', 'stack', {
                      style: { base: { direction: 'row', align: 'center', gap: 'space:6' } },
                      children: [locales, name],
                    }),
                  ]),
                ],
              }),
            ]
          : [
              node('footer-stack', 'stack', {
                style: { base: { gap: 'space:10' }, mobile: { gap: 'space:8' } },
                children: [
                  row('footer-top', [brand, links], { align: 'start' }),
                  rule,
                  row('footer-bottom', [name, locales]),
                ],
              }),
            ];
  const [y, mobileY] = kind === 'minimal' ? look.rhythm.tight : look.rhythm.section;
  return node('footer', 'section', {
    props: { as: 'footer' },
    style: {
      base: {
        ...toneStyle(tone),
        paddingY: y,
      },
      mobile: { paddingY: mobileY },
    },
    children,
  });
}

/** A full-width hairline between header or footer and the page. */
const rule = (id: string): DesignNode =>
  node(id, 'divider', { style: { base: { borderColor: 'color:border' } } });

/** The `default` layout: header, page and footer. */
export function presetLayout(recipe: Recipe, menu = MAIN_MENU): LayoutDesign {
  return {
    root: node('root', 'stack', {
      style: { base: { minHeight: '100vh' } },
      children: kids(
        recipe.look.header.strip &&
          node('strip', 'box', {
            style: {
              base: {
                height: '0.375rem',
                background: 'color:primary',
                backgroundGradient: { from: 'color:primary', to: 'color:accent', angle: 90 },
              },
            },
          }),
        header(recipe, menu),
        recipe.look.header.border && rule('header-line'),
        node('body', 'box', {
          props: { as: 'main' },
          style: { base: { grow: true } },
          children: [node('slot', 'slot')],
        }),
        recipe.look.footer.tone === 'bg' && rule('footer-line'),
        footer(recipe, menu),
      ),
    }),
  };
}

/** The header menu: one level shown, a dropdown for the second, off-canvas on tablets. */
export function presetMainMenu(recipe: Recipe): MenuDesign {
  const { look } = recipe;
  const tone = look.header.tone;
  const loud = isLoud(tone);
  const ink = (inkOf(tone) ?? 'color:text') as NonNullable<StyleProps['color']>;
  const accent = loud ? ink : 'color:primary';
  const top: MenuLevelStyle = (() => {
    switch (look.menu.style) {
      case 'pill':
        return {
          list: { base: { gap: 'space:1' } },
          link: {
            base: {
              color: ink,
              textDecoration: 'none',
              fontWeight: 600,
              paddingX: 'space:4',
              paddingY: 'space:2',
              radius: 'radius:full',
            },
            hover: { background: loud ? 'color:onPrimary/15' : 'color:primary/10', color: accent },
          },
          current: loud
            ? { background: 'color:onPrimary/20' }
            : { background: 'color:primary', color: 'color:onPrimary' },
        };
      case 'caps':
        return {
          list: { base: { gap: 'space:8' } },
          link: {
            base: {
              color: ink,
              textDecoration: 'none',
              textTransform: 'uppercase',
              type: 'type:xs',
              fontWeight: 700,
              paddingY: 'space:2',
            },
            hover: { color: accent },
          },
          current: { color: accent, textDecoration: 'underline' },
        };
      case 'underline':
        return {
          list: { base: { gap: 'space:6' } },
          link: {
            base: { color: ink, textDecoration: 'none', fontWeight: 500, paddingY: 'space:2' },
            hover: { color: accent, textDecoration: 'underline' },
          },
          current: { color: accent, textDecoration: 'underline', fontWeight: 600 },
        };
      case 'boxed':
        return {
          list: { base: { gap: 'space:2' } },
          link: {
            base: {
              color: ink,
              textDecoration: 'none',
              fontWeight: 600,
              type: 'type:sm',
              paddingX: 'space:4',
              paddingY: 'space:2',
              radius: look.radius,
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: loud ? 'color:onPrimary/25' : 'color:border',
            },
            hover: { borderColor: loud ? ink : 'color:primary', color: accent },
          },
          current: loud
            ? { background: ink, color: tone === 'ink' ? 'color:text' : 'color:primary' }
            : { background: 'color:text', color: 'color:bg', borderColor: 'color:text' },
        };
      case 'plain':
        return {
          list: { base: { gap: 'space:6' } },
          link: {
            base: { color: loud ? ink : 'color:muted', textDecoration: 'none', fontWeight: 500 },
            hover: { color: loud ? ink : 'color:text' },
          },
          current: { color: loud ? ink : 'color:text', fontWeight: 700 },
        };
    }
  })();
  return {
    preset: 'dropdown',
    depth: 2,
    levels: [
      top,
      {
        list: {
          base: {
            background: 'color:bg',
            padding: 'space:2',
            radius: 'radius:md',
            shadow: 'shadow:lg',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: 'color:border',
          },
        },
        link: {
          base: {
            paddingX: 'space:3',
            paddingY: 'space:2',
            radius: 'radius:sm',
            color: 'color:text',
            textDecoration: 'none',
            textTransform: 'none',
            type: 'type:sm',
          },
          hover: { background: 'color:surface', color: 'color:primary' },
        },
      },
    ],
    mobile: {
      behaviour: 'offcanvas',
      breakpoint: 'tablet',
      label: say(recipe, { en: 'Menu', de: 'Menü' }),
      toggle: { base: { color: ink } },
      panel: {
        base: {
          ...toneStyle(tone === 'gradient' ? 'primary' : tone),
          paddingX: 'space:6',
          paddingY: 'space:10',
          shadow: 'shadow:lg',
        },
      },
    },
  };
}

/** The footer's copy of the header menu: one row of quiet links. */
export function presetFooterMenu(recipe: Recipe): MenuDesign {
  const tone = recipe.look.footer.tone;
  const loud = isLoud(tone);
  return {
    preset: 'bar',
    depth: 1,
    levels: [
      {
        list: { base: { gap: 'space:6', wrap: true }, mobile: { gap: 'space:4' } },
        link: {
          base: {
            color: softText(tone),
            textDecoration: 'none',
            fontWeight: 500,
            type: 'type:sm',
          },
          hover: { color: loud ? inkOf(tone) : 'color:primary' },
        },
        current: { color: loud ? inkOf(tone) : 'color:text' },
      },
    ],
    mobile: { behaviour: 'none', breakpoint: 'mobile' },
  };
}
