/** Authoring languages as codes; names come from `Intl.DisplayNames`. */

/** Most spoken languages, pinned above the rest. */
const POPULAR_LOCALES = [
  'en',
  'zh',
  'hi',
  'es',
  'ar',
  'fr',
  'bn',
  'pt',
  'ru',
  'ur',
  'id',
  'de',
  'ja',
  'sw',
  'mr',
  'te',
  'tr',
  'ta',
  'vi',
  'ko',
  'it',
  'th',
  'pl',
  'nl',
] as const;

/** Sorted by display name at load. */
const OTHER_LOCALES = [
  'af',
  'am',
  'as',
  'az',
  'be',
  'bg',
  'bo',
  'bs',
  'ca',
  'ceb',
  'ckb',
  'cs',
  'cy',
  'da',
  'dv',
  'dz',
  'el',
  'eo',
  'et',
  'eu',
  'fa',
  'ff',
  'fi',
  'fil',
  'fo',
  'fy',
  'ga',
  'gd',
  'gl',
  'gu',
  'ha',
  'haw',
  'he',
  'hr',
  'ht',
  'hu',
  'hy',
  'ig',
  'is',
  'jv',
  'ka',
  'kk',
  'km',
  'kn',
  'ku',
  'ky',
  'la',
  'lb',
  'lo',
  'lt',
  'lv',
  'mg',
  'mi',
  'mk',
  'ml',
  'mn',
  'ms',
  'mt',
  'my',
  'nb',
  'ne',
  'nn',
  'ny',
  'or',
  'pa',
  'ps',
  'qu',
  'rn',
  'ro',
  'rw',
  'sd',
  'si',
  'sk',
  'sl',
  'sm',
  'sn',
  'so',
  'sq',
  'sr',
  'st',
  'su',
  'sv',
  'tg',
  'ti',
  'tk',
  'tn',
  'to',
  'tt',
  'ug',
  'uk',
  'uz',
  'wo',
  'xh',
  'yi',
  'yo',
  'zu',
];

const displayNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    return null;
  }
})();

/** The English name, or the code. */
export function localeName(code: string): string {
  try {
    return displayNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

export interface LocaleOption {
  code: string;
  name: string;
  popular: boolean;
}

const byName = (a: LocaleOption, b: LocaleOption) => a.name.localeCompare(b.name, 'en');

const popular: LocaleOption[] = POPULAR_LOCALES.map((code) => ({
  code,
  name: localeName(code),
  popular: true,
})).sort(byName);

const others: LocaleOption[] = OTHER_LOCALES.map((code) => ({
  code,
  name: localeName(code),
  popular: false,
})).sort(byName);

const LOCALE_OPTIONS: LocaleOption[] = [...popular, ...others];

const BY_CODE = new Map(LOCALE_OPTIONS.map((option) => [option.code, option]));

/** Options matching a query. Unknown `selected` codes are included so they stay removable. */
export function localeOptions(query: string, selected: readonly string[]): LocaleOption[] {
  const unknown = selected
    .filter((code) => !BY_CODE.has(code))
    .map((code) => ({ code, name: localeName(code), popular: false }));

  const term = query.trim().toLowerCase();
  const all = [...LOCALE_OPTIONS, ...unknown];
  if (!term) return all;
  return all.filter(
    (option) =>
      option.name.toLowerCase().includes(term) || option.code.toLowerCase().startsWith(term),
  );
}
