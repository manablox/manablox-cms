import { useLocalStorage, useMediaQuery } from '@vueuse/core';
import { computed, watchEffect } from 'vue';

type ThemePreference = 'system' | 'light' | 'dark';
const THEME_KEY = 'manablox.theme';

/** Theme as a `dark` class and `color-scheme` on `<html>`; `index.html` applies it first. */
const preference = useLocalStorage<ThemePreference>(THEME_KEY, 'system');
const systemDark = useMediaQuery('(prefers-color-scheme: dark)');

const isDark = computed(() =>
  preference.value === 'system' ? systemDark.value : preference.value === 'dark',
);

let installed = false;
export function installTheme(): void {
  if (installed) return;
  installed = true;
  watchEffect(() => {
    document.documentElement.classList.toggle('dark', isDark.value);
    document.documentElement.style.colorScheme = isDark.value ? 'dark' : 'light';
  });
}

export const theme = {
  preference,
  isDark,
  /** Light, dark, system, repeat. */
  cycle(): void {
    const order: ThemePreference[] = ['light', 'dark', 'system'];
    const at = order.indexOf(preference.value);
    preference.value = order[(at + 1) % order.length] as ThemePreference;
  },
};
