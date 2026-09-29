/**
 * The randomness the seed is built from: faker with a fixed seed, plus the few shapes
 * this repository stores that faker knows nothing about - a Tiptap document, a machine
 * name that is still free, a grid a block list sits on.
 *
 * Everything goes through the one seeded generator, so `SEED=1 pnpm seed:testing` twice
 * over produces the same instance twice over. A run that cannot be reproduced is a poor
 * bug report.
 */
import { faker } from '@faker-js/faker';
import type { BlockGridValue } from '@manablox/core';

export { faker };

/** Seeds the generator. Called once, from `main.mts`, before anything is built. */
export function seedFaker(seed: number): void {
  faker.seed(seed);
}

export const pick = <T,>(items: readonly T[]): T => faker.helpers.arrayElement(items);

/** Between `min` and `max` distinct entries, both clamped to what there is to draw from. */
export const sample = <T,>(items: readonly T[], min: number, max: number): T[] => {
  if (items.length === 0) return [];
  const top = Math.min(max, items.length);
  return faker.helpers.arrayElements(items, { min: Math.min(min, top), max: top });
};

export const count = (min: number, max: number): number => faker.number.int({ min, max });

/** True `probability` of the time; the seed's coin flip. */
export const chance = (probability: number): boolean => faker.number.float() < probability;

export const sentence = (words = 8): string => faker.lorem.sentence(words);

export const words = (n: number): string => faker.lorem.words(n);

/** A title that reads like a page title rather than a lorem sentence. */
export const title = (): string =>
  faker.helpers.arrayElement([
    faker.commerce.productName(),
    faker.company.catchPhrase(),
    faker.lorem.words({ min: 2, max: 5 }),
    `${faker.word.adjective()} ${faker.word.noun()}`,
  ]);

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * Rich text as the editor stores it: a Tiptap document. Headings, prose with marks, a
 * list and the odd quote or code block, so a renderer meets more than paragraphs.
 */
export function richText(paragraphs = count(2, 5)): Record<string, unknown> {
  const content: Record<string, unknown>[] = [];
  for (let index = 0; index < paragraphs; index++) {
    if (index > 0 && chance(0.4)) {
      content.push({
        type: 'heading',
        attrs: { level: pick([2, 3]) },
        content: [{ type: 'text', text: capitalise(faker.lorem.words({ min: 2, max: 5 })) }],
      });
    }
    content.push({
      type: 'paragraph',
      content: [
        { type: 'text', text: `${faker.lorem.sentence()} ` },
        {
          type: 'text',
          marks: [{ type: pick(['bold', 'italic', 'code']) }],
          text: faker.lorem.words(3),
        },
        { type: 'text', text: ` ${faker.lorem.sentence()}` },
      ],
    });
    if (chance(0.25)) {
      content.push({
        type: 'bulletList',
        content: Array.from({ length: count(2, 5) }, () => ({
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: faker.lorem.sentence(6) }] },
          ],
        })),
      });
    }
    if (chance(0.15)) {
      content.push({
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: faker.lorem.sentence() }] }],
      });
    }
  }
  return { type: 'doc', content };
}

/** A grid for a block field, sometimes. A list is the common case; a grid is the interesting one. */
export function maybeGrid(): BlockGridValue | undefined {
  if (!chance(0.35)) return undefined;
  const columns = pick([2, 3, 4]);
  return {
    desktop: { columns },
    tablet: { columns: Math.max(1, columns - 1) },
    mobile: { columns: 1 },
  };
}

/**
 * A machine name that is free, remembered as taken. Content type names, menu machine
 * names and webhook slugs all have to be unique within a space, and a seed run that
 * lands on a name an earlier run took should carry on rather than stop.
 */
export function freeName(base: string, taken: Set<string>, separator = '_'): string {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}|\\${separator}$`, 'g'), '');
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  for (let n = 2; ; n++) {
    const candidate = `${slug}${separator}${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/** The same, hyphenated: a slug and a machine name are spelled differently here. */
export function freeSlug(base: string, taken: Set<string>): string {
  return freeName(base, taken, '-');
}
