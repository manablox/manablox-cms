import type { FontFamily } from '../types.js';
import { clone } from '../util.js';

/** Open fonts the renderer ships under `/_site/fonts/<bundledPath>`. */
export const BUNDLED_FONTS: readonly FontFamily[] = [
  {
    id: 'inter',
    name: 'Inter',
    source: 'bundled',
    files: [
      { bundledPath: 'inter/Inter-Variable.woff2', weight: '100 900', style: 'normal' },
      { bundledPath: 'inter/Inter-Italic-Variable.woff2', weight: '100 900', style: 'italic' },
    ],
    fallback: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  {
    id: 'source-serif-4',
    name: 'Source Serif 4',
    source: 'bundled',
    files: [
      {
        bundledPath: 'source-serif-4/SourceSerif4-Variable.woff2',
        weight: '200 900',
        style: 'normal',
      },
      {
        bundledPath: 'source-serif-4/SourceSerif4-Italic-Variable.woff2',
        weight: '200 900',
        style: 'italic',
      },
    ],
    fallback: 'Georgia, "Times New Roman", serif',
  },
  {
    id: 'space-grotesk',
    name: 'Space Grotesk',
    source: 'bundled',
    files: [
      {
        bundledPath: 'space-grotesk/SpaceGrotesk-Variable.woff2',
        weight: '300 700',
        style: 'normal',
      },
    ],
    fallback: 'system-ui, sans-serif',
  },
  {
    id: 'fraunces',
    name: 'Fraunces',
    source: 'bundled',
    files: [
      { bundledPath: 'fraunces/Fraunces-Variable.woff2', weight: '100 900', style: 'normal' },
    ],
    fallback: 'Georgia, "Times New Roman", serif',
  },
  {
    id: 'lora',
    name: 'Lora',
    source: 'bundled',
    files: [
      { bundledPath: 'lora/Lora-Variable.woff2', weight: '400 700', style: 'normal' },
      { bundledPath: 'lora/Lora-Italic-Variable.woff2', weight: '400 700', style: 'italic' },
    ],
    fallback: 'Georgia, "Times New Roman", serif',
  },
  {
    id: 'outfit',
    name: 'Outfit',
    source: 'bundled',
    files: [{ bundledPath: 'outfit/Outfit-Variable.woff2', weight: '100 900', style: 'normal' }],
    fallback: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  {
    id: 'dm-sans',
    name: 'DM Sans',
    source: 'bundled',
    files: [
      { bundledPath: 'dm-sans/DMSans-Variable.woff2', weight: '100 900', style: 'normal' },
      { bundledPath: 'dm-sans/DMSans-Italic-Variable.woff2', weight: '100 900', style: 'italic' },
    ],
    fallback: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  {
    id: 'bricolage-grotesque',
    name: 'Bricolage Grotesque',
    source: 'bundled',
    files: [
      {
        bundledPath: 'bricolage-grotesque/BricolageGrotesque-Variable.woff2',
        weight: '200 800',
        style: 'normal',
      },
    ],
    fallback: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  {
    id: 'plus-jakarta-sans',
    name: 'Plus Jakarta Sans',
    source: 'bundled',
    files: [
      {
        bundledPath: 'plus-jakarta-sans/PlusJakartaSans-Variable.woff2',
        weight: '200 800',
        style: 'normal',
      },
      {
        bundledPath: 'plus-jakarta-sans/PlusJakartaSans-Italic-Variable.woff2',
        weight: '200 800',
        style: 'italic',
      },
    ],
    fallback: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  {
    id: 'jetbrains-mono',
    name: 'JetBrains Mono',
    source: 'bundled',
    files: [
      {
        bundledPath: 'jetbrains-mono/JetBrainsMono-Variable.woff2',
        weight: '100 800',
        style: 'normal',
      },
    ],
    fallback: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
];

/** A copy of a bundled family, for a theme to own. */
export function bundledFont(id: string): FontFamily {
  const family = BUNDLED_FONTS.find((entry) => entry.id === id);
  if (!family) throw new Error(`Unknown bundled font: ${id}`);
  return clone(family);
}
