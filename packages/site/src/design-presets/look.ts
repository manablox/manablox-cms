import type { SpaceRef, StyleProps } from '../types.js';

/** Background of a band: page, surface, primary, primary into accent, or inverted. */
export type Tone = 'bg' | 'surface' | 'primary' | 'gradient' | 'ink';

type Radius = 'radius:sm' | 'radius:md' | 'radius:lg' | '0';

/**
 * The choices that set one design preset apart. Colors, fonts, buttons and shadows come
 * from the theme, so every preset works with every theme.
 */
export interface Look {
  header: {
    /**
     * `bar`: logo left, menu right; `centered`: both centered, stacked; `split`: logo,
     * centered menu, locale switch; `floating`: a bar on a raised, rounded panel.
     */
    kind: 'bar' | 'centered' | 'split' | 'floating';
    tone: Tone;
    /** A line under the header. */
    border: boolean;
    /** A primary into accent strip above the header. */
    strip: boolean;
    logo: StyleProps;
  };
  menu: {
    /** How the main menu marks hover and the current page. */
    style: 'underline' | 'pill' | 'caps' | 'plain' | 'boxed';
  };
  footer: {
    /** `columns`: brand and menu side by side; `display`: the site name set large; `minimal`: one line; `centered`: stacked. */
    kind: 'columns' | 'display' | 'minimal' | 'centered';
    tone: Tone;
  };
  /**
   * `split`: text beside the image; `display`: centered, large; `editorial`: headline over
   * a rule and a wide image; `portrait`: a round image beside a greeting; `panel`: text and
   * image on a colored panel; `statement`: a huge headline, then the subline beside a wide
   * image; `fullbleed`: the headline, then the image edge to edge; `compact`: a short intro
   * beside a small square image.
   */
  hero:
    | 'split'
    | 'display'
    | 'editorial'
    | 'portrait'
    | 'panel'
    | 'statement'
    | 'fullbleed'
    | 'compact';
  heroTone: Tone;
  /** The image of a split hero on the left. */
  mirror?: boolean;
  /** Section intro text: headline beside the body, or above it; `ruled` sets a rule above. */
  text: 'split' | 'stacked' | 'centered' | 'ruled';
  /** `accent`: a colored bar on top. */
  card: 'elevated' | 'bordered' | 'tinted' | 'outlined' | 'plain' | 'accent';
  /** Lists of linked documents: a card grid, rows with the image beside the text, or a text index. */
  list: 'grid' | 'rows' | 'index';
  /** Testimonials: cards, one large quote per row, or quotes beside an accent bar. */
  quote: 'cards' | 'large' | 'bar';
  /** Calls to action: a tinted panel, a full band in the highlight tone, or an outlined box. */
  cta: 'panel' | 'band' | 'outline';
  /** Tone of the highlight bands: testimonials and calls to action. */
  highlight: Tone;
  /** Alternate band of list sections. */
  alternate: Tone;
  kicker: 'bar' | 'dot' | 'rule' | 'square' | 'none';
  titles: {
    weight?: NonNullable<StyleProps['fontWeight']>;
    uppercase?: boolean;
    italic?: boolean;
    center: boolean;
  };
  /** Top of text and article pages: on the alternate band, plain with a rule, or on a gradient. */
  pageHeader: 'band' | 'plain' | 'gradient';
  /** Team photos. */
  portraits: 'round' | 'square';
  radius: Radius;
  /** Card grid columns. */
  columns: 2 | 3;
  /** Aspect ratio of card images. */
  media: '4/3' | '3/2' | '16/9' | '3/4' | '1/1';
  /** Width of running text. */
  reading: 'sm' | 'md';
  rhythm: {
    /** Vertical padding of a band, desktop and mobile. */
    section: [SpaceRef, SpaceRef];
    tight: [SpaceRef, SpaceRef];
  };
}
