import { COLOR_ROLES, type DesignNode, type PageDesign, type ThemeDesign } from '@manablox/site';
import { colorRoleLabel } from './tokens';

/** The field of the style guide's type its rich text sample binds. */
export const PROSE_FIELD_ID = 'prose';
/** The synthetic databag type the sample form asks for. */
export const FORM_TYPE_ID = 'style-guide-form';

const HEADINGS = [
  'The quick brown fox',
  'Jumps over the lazy dog',
  'Pack my box with five dozen jugs',
  'How vexingly quick daft zebras jump',
  'Sphinx of black quartz, judge my vow',
  'The five boxing wizards jump quickly',
];

const text = (locale: string, value: string) => ({ [locale]: value });

function section(id: string, title: string, locale: string, children: DesignNode[]): DesignNode {
  return {
    id,
    el: 'section',
    style: { base: { paddingY: 'space:10' }, mobile: { paddingY: 'space:6' } },
    children: [
      {
        id: `${id}-stack`,
        el: 'stack',
        style: { base: { gap: 'space:6' } },
        children: [
          {
            id: `${id}-title`,
            el: 'text',
            props: { text: text(locale, title) },
            style: {
              base: {
                type: 'type:sm',
                color: 'color:muted',
                textTransform: 'uppercase',
                fontWeight: 600,
              },
            },
          },
          ...children,
        ],
      },
    ],
  };
}

function colorSwatches(theme: ThemeDesign, locale: string): DesignNode[] {
  return COLOR_ROLES.map((role) => ({
    id: `swatch-${role}`,
    el: 'stack',
    style: { base: { gap: 'space:2' } },
    children: [
      {
        id: `swatch-${role}-chip`,
        el: 'box',
        style: {
          base: {
            minHeight: '4rem',
            background: `color:${role}`,
            radius: 'radius:md',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: 'color:border',
          },
        },
      },
      {
        id: `swatch-${role}-name`,
        el: 'text',
        props: { text: text(locale, colorRoleLabel(role)) },
        style: { base: { type: 'type:sm', fontWeight: 600 } },
      },
      {
        id: `swatch-${role}-value`,
        el: 'text',
        props: { text: text(locale, theme.colors.roles[role] ?? '') },
        style: { base: { type: 'type:xs', color: 'color:muted' } },
      },
    ],
  }));
}

function spaceBars(theme: ThemeDesign, locale: string): DesignNode[] {
  return Object.keys(theme.space)
    .filter((name) => name !== '0')
    .map((name) => {
      const id = `space-${name.replace(/[^a-zA-Z0-9-]/g, '')}`;
      return {
        id,
        el: 'stack',
        style: { base: { direction: 'row', align: 'center', gap: 'space:4' } },
        children: [
          {
            id: `${id}-label`,
            el: 'text',
            props: { text: text(locale, `${name} - ${theme.space[name]}`) },
            style: { base: { type: 'type:xs', color: 'color:muted', minWidth: '7rem' } },
          },
          {
            id: `${id}-bar`,
            el: 'box',
            style: {
              base: {
                paddingLeft: `space:${name}`,
                minHeight: '0.75rem',
                background: 'color:primary',
                radius: 'radius:sm',
              },
            },
          },
        ],
      } satisfies DesignNode;
    });
}

/** A sample form: labels, every kind of input, help text, the button and the message. */
function sampleForm(locale: string): DesignNode {
  const field = (id: string, props: Record<string, unknown> = {}): DesignNode => ({
    id: `field-${id}`,
    el: 'formField',
    props: { fieldId: id, ...props },
  });
  return {
    id: 'form-sample',
    el: 'form',
    props: {
      databagTypeId: FORM_TYPE_ID,
      successMessage: text(locale, 'Thank you, your message is on its way.'),
    },
    style: { base: { gap: 'space:4', maxWidth: 'container:sm' } },
    children: [
      {
        id: 'form-row',
        el: 'grid',
        style: { base: { columns: 2, gap: 'space:4' }, mobile: { columns: 1 } },
        children: [
          field('name', { placeholder: text(locale, 'Your name') }),
          field('email', { placeholder: text(locale, 'you@example.com') }),
        ],
      },
      field('topic', { placeholder: text(locale, 'Pick one') }),
      field('message', {
        placeholder: text(locale, 'What would you like to tell us?'),
        help: text(locale, 'Help text sits under a field.'),
      }),
      field('newsletter'),
      { id: 'form-submit', el: 'formSubmit', style: { base: { alignSelf: 'start' } } },
      { id: 'form-message', el: 'formMessage' },
    ],
  };
}

/** A box per radius or shadow token, named below it. */
function tokenBoxes(theme: ThemeDesign, group: 'radius' | 'shadow', locale: string): DesignNode[] {
  return Object.keys(group === 'radius' ? theme.radius : theme.shadow).map((name) => {
    const id = `${group}-${name.replace(/[^a-zA-Z0-9-]/g, '')}`;
    return {
      id,
      el: 'stack',
      style: { base: { gap: 'space:2', align: 'center' } },
      children: [
        {
          id: `${id}-box`,
          el: 'box',
          style: {
            base: {
              minHeight: '4rem',
              width: '6rem',
              background: 'color:surface',
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: 'color:border',
              ...(group === 'radius'
                ? { radius: `radius:${name}` as const }
                : { shadow: `shadow:${name}` as const, radius: 'radius:md' as const }),
            },
          },
        },
        {
          id: `${id}-name`,
          el: 'text',
          props: { text: text(locale, name) },
          style: { base: { type: 'type:xs', color: 'color:muted' } },
        },
      ],
    } satisfies DesignNode;
  });
}

/** The style guide page: type, text, buttons, links, forms, colors, spacing, radius and shadows. */
export function styleGuidePage(theme: ThemeDesign, locale: string): PageDesign {
  const headings: DesignNode[] = HEADINGS.map((value, index) => ({
    id: `h${index + 1}`,
    el: 'heading',
    props: { level: index + 1, text: text(locale, value) },
  }));
  const row = (id: string, children: DesignNode[]): DesignNode => ({
    id,
    el: 'stack',
    style: { base: { direction: 'row', wrap: true, gap: 'space:4', align: 'center' } },
    children,
  });

  return {
    root: {
      id: 'root',
      el: 'stack',
      children: [
        section('typography', 'Typography', locale, [
          { id: 'headings', el: 'stack', style: { base: { gap: 'space:4' } }, children: headings },
          {
            id: 'body-text',
            el: 'text',
            props: {
              text: text(
                locale,
                'Body text reads like this. A comfortable line length and line height make long passages easy to follow on every screen.',
              ),
            },
          },
          {
            id: 'muted-text',
            el: 'text',
            props: { text: text(locale, 'Muted text, for captions and secondary details.') },
            style: { base: { color: 'color:muted', type: 'type:sm' } },
          },
          { id: 'prose-sample', el: 'richtext', bind: { field: PROSE_FIELD_ID } },
        ]),
        section('actions', 'Buttons and links', locale, [
          row(
            'buttons',
            (['primary', 'secondary', 'ghost'] as const).map((variant) => ({
              id: `button-${variant}`,
              el: 'button',
              props: {
                text: text(locale, `${variant[0]?.toUpperCase()}${variant.slice(1)} button`),
                variant,
                href: '#',
              },
            })),
          ),
          {
            id: 'link-sample',
            el: 'link',
            props: { text: text(locale, 'A plain link'), href: '#' },
          },
        ]),
        section('forms', 'Forms', locale, [sampleForm(locale)]),
        section('colors', 'Colors', locale, [
          {
            id: 'swatches',
            el: 'grid',
            style: { base: { columns: 4, gap: 'space:4' }, mobile: { columns: 2 } },
            children: colorSwatches(theme, locale),
          },
        ]),
        section('spacing', 'Spacing', locale, [
          {
            id: 'space-bars',
            el: 'stack',
            style: { base: { gap: 'space:2' } },
            children: spaceBars(theme, locale),
          },
        ]),
        section('corners', 'Corners and shadows', locale, [
          row('radius-row', tokenBoxes(theme, 'radius', locale)),
          row('shadow-row', tokenBoxes(theme, 'shadow', locale)),
        ]),
      ],
    },
  };
}
