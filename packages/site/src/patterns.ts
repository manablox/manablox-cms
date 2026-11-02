/** Value patterns shared by validation and the CSS compiler, which re-checks before emitting. */

export const COLOR =
  /^(?:#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([0-9a-zA-Z.,%\s/+-]{1,80}\)|transparent|currentColor|white|black)$/;
/** Whether a theme accepts `value` as a color. */
export const isThemeColor = (value: string): boolean => COLOR.test(value.trim());
export const SHADOW = /^[a-zA-Z0-9#.,()%\s/-]{1,200}$/;
export const FONT_NAME = /^[a-zA-Z0-9 _-]{1,80}$/;
export const FONT_FALLBACK = /^[a-zA-Z0-9 ,"'_-]{0,200}$/;
export const BUNDLED_PATH = /^(?!.*\.\.)[a-zA-Z0-9_-][a-zA-Z0-9._/-]{0,199}$/;
export const FONT_WEIGHT = /^[1-9]00(?: [1-9]00)?$/;
export const WEIGHTS: readonly number[] = [100, 200, 300, 400, 500, 600, 700, 800, 900];
