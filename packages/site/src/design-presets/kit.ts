import type {
  BindingFormat,
  ColorRef,
  DesignNode,
  ElementKind,
  LocalizedText,
  NodeVisibility,
  StyleProps,
  StyleRules,
} from '../types.js';
import type { Look, Tone } from './look.js';

/** What a preset reads of a content type: its machine name, kind and fields by name. */
export interface PresetField {
  name: string;
  type: string;
  settings?: Record<string, unknown> | undefined;
}

export interface PresetType {
  name: string;
  kind: string;
  fields: readonly PresetField[];
}

/** One design of a preset: the layout, a menu, or a block or page design of a type. */
export interface Recipe {
  look: Look;
  locale: string;
}

export function fieldOf(
  type: PresetType,
  name: string,
  ...types: string[]
): PresetField | undefined {
  return type.fields.find(
    (field) => field.name === name && (!types.length || types.includes(field.type)),
  );
}

/** Whether every `name: type` pair is a field of the type. */
export function hasFields(type: PresetType, wanted: Record<string, string>): boolean {
  return Object.entries(wanted).every(([name, kind]) => fieldOf(type, name, kind) !== undefined);
}

interface NodeOptions {
  bind?: string;
  format?: BindingFormat;
  props?: Record<string, unknown>;
  style?: StyleRules;
  visibility?: NodeVisibility;
  children?: DesignNode[];
}

export function node(id: string, el: ElementKind, options: NodeOptions = {}): DesignNode {
  const out: DesignNode = { id, el };
  if (options.bind)
    out.bind = options.format
      ? { field: options.bind, format: options.format }
      : { field: options.bind };
  if (options.props) out.props = options.props;
  if (options.style) out.style = options.style;
  if (options.visibility) out.visibility = options.visibility;
  if (options.children) out.children = options.children;
  return out;
}

/** Drops `false` entries, for optional children. */
export function kids(...entries: Array<DesignNode | false | null | undefined>): DesignNode[] {
  return entries.filter((entry): entry is DesignNode => Boolean(entry));
}

export const when = (field: string): NodeVisibility => ({ whenField: field });

/** Static text in the space's default locale, with English and German where known. */
export function say(recipe: Recipe, text: Record<'en' | 'de', string>): LocalizedText {
  const out: LocalizedText = { en: text.en, de: text.de };
  if (!Object.hasOwn(out, recipe.locale)) out[recipe.locale] = text.en;
  return out;
}

/** Background and text color of a tone. */
export function toneStyle(tone: Tone): StyleProps {
  switch (tone) {
    case 'bg':
      return { background: 'color:bg', color: 'color:text' };
    case 'surface':
      return { background: 'color:surface', color: 'color:text' };
    case 'primary':
      return { background: 'color:primary', color: 'color:onPrimary' };
    case 'gradient':
      return {
        background: 'color:primary',
        backgroundGradient: { from: 'color:primary', to: 'color:accent/45', angle: 135 },
        color: 'color:onPrimary',
      };
    case 'ink':
      return { background: 'color:text', color: 'color:bg' };
  }
}

/** Text color on a tone. */
export function inkOf(tone: Tone): ColorRef {
  if (tone === 'primary' || tone === 'gradient') return 'color:onPrimary';
  return tone === 'ink' ? 'color:bg' : 'color:text';
}

/** Whether text on the tone takes the tone's own color rather than `muted`. */
export const isLoud = (tone: Tone): boolean =>
  tone === 'primary' || tone === 'gradient' || tone === 'ink';

/** The secondary text color on a tone. */
export function softText(tone: Tone): ColorRef {
  if (tone === 'primary' || tone === 'gradient') return 'color:onPrimary/80';
  if (tone === 'ink') return 'color:bg/70';
  return 'color:muted';
}

/** A full-width band with the look's vertical rhythm; content sits in the container. */
export function band(
  id: string,
  look: Look,
  tone: Tone,
  children: DesignNode[],
  options: {
    container?: string;
    tight?: boolean;
    style?: StyleProps;
    visibility?: NodeVisibility;
  } = {},
): DesignNode {
  const [y, mobileY] = options.tight ? look.rhythm.tight : look.rhythm.section;
  return node(id, 'section', {
    ...(options.visibility ? { visibility: options.visibility } : {}),
    ...(options.container ? { props: { container: options.container } } : {}),
    style: {
      base: { ...toneStyle(tone), paddingY: y, ...options.style },
      mobile: { paddingY: mobileY },
    },
    children,
  });
}

/** The small accent mark above a section heading. */
export function kicker(id: string, look: Look, tone: Tone): DesignNode | null {
  const color = isLoud(tone) ? 'color:onPrimary/70' : 'color:accent';
  switch (look.kicker) {
    case 'bar':
      return node(id, 'box', {
        style: {
          base: {
            width: '3rem',
            height: '0.3rem',
            radius: 'radius:full',
            background: tone === 'ink' ? 'color:bg/60' : color,
          },
        },
      });
    case 'dot':
      return node(id, 'box', {
        style: {
          base: {
            width: '0.75rem',
            height: '0.75rem',
            radius: 'radius:full',
            background: tone === 'ink' ? 'color:bg/60' : color,
          },
        },
      });
    case 'square':
      return node(id, 'box', {
        style: {
          base: {
            width: '0.9rem',
            height: '0.9rem',
            background: tone === 'ink' ? 'color:bg/60' : isLoud(tone) ? color : 'color:primary',
          },
        },
      });
    case 'rule':
      return node(id, 'divider', {
        style: {
          base: {
            borderColor: isLoud(tone) ? 'color:onPrimary/30' : 'color:text',
            width: '100%',
          },
        },
      });
    case 'none':
      return null;
  }
}

/** A heading styled by the look: weight and case of its titles. */
export function title(
  id: string,
  look: Look,
  options: {
    bind?: string;
    text?: LocalizedText;
    level: number;
    type: `type:${string}`;
    style?: StyleProps;
    mobile?: StyleProps;
    visibility?: NodeVisibility;
  },
): DesignNode {
  return node(id, 'heading', {
    ...(options.bind ? { bind: options.bind } : {}),
    props: { level: options.level, ...(options.text ? { text: options.text } : {}) },
    style: {
      base: {
        type: options.type,
        ...(look.titles.weight ? { fontWeight: look.titles.weight } : {}),
        ...(look.titles.uppercase ? { textTransform: 'uppercase' } : {}),
        ...(look.titles.italic ? { fontStyle: 'italic' } : {}),
        ...options.style,
      },
      ...(options.mobile ? { mobile: options.mobile } : {}),
    },
    ...(options.visibility ? { visibility: options.visibility } : {}),
  });
}

/** Kicker and heading of a section, aligned by the look; `flush` drops the gap below. */
export function sectionHead(
  prefix: string,
  look: Look,
  tone: Tone,
  headline: string,
  options: { center?: boolean; flush?: boolean } = {},
): DesignNode {
  const center = options.center ?? look.titles.center;
  return node(`${prefix}-head`, 'stack', {
    style: {
      base: {
        gap: 'space:4',
        align: center ? 'center' : 'start',
        textAlign: center ? 'center' : 'left',
        marginBottom: options.flush ? '0' : 'space:10',
      },
      mobile: { marginBottom: options.flush ? '0' : 'space:8' },
    },
    visibility: when(headline),
    children: kids(
      kicker(`${prefix}-kicker`, look, tone),
      title(`${prefix}-title`, look, {
        bind: headline,
        level: 2,
        type: 'type:3xl',
        style: { maxWidth: 'container:md' },
      }),
    ),
  });
}

/** A card's box by the look, on a band of `tone`. */
export function cardStyle(look: Look, tone: Tone): StyleRules {
  const onLoud = isLoud(tone);
  const radius = look.radius;
  switch (onLoud ? 'loud' : look.card) {
    case 'loud':
      return {
        base: {
          background: tone === 'ink' ? 'color:bg/10' : 'color:onPrimary/10',
          radius,
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: tone === 'ink' ? 'color:bg/20' : 'color:onPrimary/20',
        },
      };
    case 'elevated':
      return {
        base: {
          background: tone === 'bg' ? 'color:surface' : 'color:bg',
          radius,
          shadow: 'shadow:md',
        },
        hover: { shadow: 'shadow:lg' },
      };
    case 'bordered':
      return {
        base: {
          background: 'color:bg',
          radius,
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: 'color:border',
        },
        hover: { borderColor: 'color:primary' },
      };
    case 'tinted':
      return {
        base: { background: tone === 'surface' ? 'color:bg' : 'color:primary/5', radius },
        hover: { background: tone === 'surface' ? 'color:bg' : 'color:primary/10' },
      };
    case 'outlined':
      return {
        base: {
          background: 'color:bg',
          radius,
          borderWidth: '2px',
          borderStyle: 'solid',
          borderColor: 'color:text',
          shadow: 'shadow:md',
        },
        hover: { shadow: 'shadow:lg' },
      };
    case 'accent':
      return {
        base: {
          background: tone === 'bg' ? 'color:surface' : 'color:bg',
          radius,
          shadow: 'shadow:sm',
        },
        hover: { shadow: 'shadow:md' },
      };
    case 'plain':
      return { base: { radius } };
  }
}

/** The colored bar on top of an `accent` card. */
export function cardBar(id: string, look: Look, tone: Tone): DesignNode | null {
  if (look.card !== 'accent' || isLoud(tone)) return null;
  return node(id, 'box', {
    style: {
      base: {
        height: '0.3rem',
        background: 'color:primary',
        backgroundGradient: { from: 'color:primary', to: 'color:accent', angle: 90 },
      },
    },
  });
}

/** Inner padding of a card; none for plain cards, whose text sits under the image. */
export function cardPadding(look: Look, tone: Tone): StyleRules {
  if (look.card === 'plain' && !isLoud(tone))
    return { base: { paddingTop: 'space:4', gap: 'space:2' } };
  return {
    base: { padding: 'space:6', gap: 'space:3' },
    mobile: { padding: 'space:5' },
  };
}

/** Grid columns with tablet and mobile fallbacks. */
export function gridStyle(columns: number, gap: `space:${string}` = 'space:6'): StyleRules {
  return {
    base: { display: 'grid', columns, gap },
    tablet: { columns: Math.min(columns, 2) },
    mobile: { columns: 1 },
  };
}

/** A small arrow in the primary color, for cards that link on. */
export function arrow(id: string, tone: Tone): DesignNode {
  return node(id, 'icon', {
    props: { name: 'arrow-right' },
    style: { base: { color: isLoud(tone) ? 'color:onPrimary' : 'color:primary' } },
  });
}

/**
 * An image in a frame of fixed ratio. The frame's gradient shows until an image is picked,
 * so a fresh site already has color where its pictures go.
 */
export function frame(
  id: string,
  look: Look,
  bind: string,
  options: {
    ratio?: NonNullable<StyleProps['aspectRatio']>;
    radius?: StyleProps['radius'];
    style?: StyleProps;
    mobile?: StyleProps;
    hover?: StyleProps;
    visibility?: NodeVisibility;
  } = {},
): DesignNode {
  return node(id, 'box', {
    style: {
      base: {
        aspectRatio: options.ratio ?? look.media,
        radius: options.radius ?? look.radius,
        overflow: 'hidden',
        background: 'color:surface',
        backgroundGradient: {
          from: 'color:primary/85',
          via: 'color:primary/55',
          to: 'color:accent/70',
          angle: 135,
        },
        ...options.style,
      },
      ...(options.mobile ? { mobile: options.mobile } : {}),
      ...(options.hover ? { hover: options.hover } : {}),
    },
    ...(options.visibility ? { visibility: options.visibility } : {}),
    children: [
      node(`${id}-img`, 'image', {
        bind,
        style: { base: { width: '100%', height: '100%', objectFit: 'cover' } },
      }),
    ],
  });
}
