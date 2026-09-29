/**
 * How much of everything a run makes. `SEED_SCALE` picks one; every number can still be
 * overridden on its own, which is what a bug that only shows up at four hundred blocks
 * in one document needs.
 */
export interface Scale {
  /** Spaces built from scratch, on top of whatever the instance already has. */
  spaces: number;
  /** Locales each space gets. The first one is its default. */
  locales: string[];
  blockTypes: number;
  contentTypes: number;
  fieldsPerType: [number, number];
  assets: number;
  templates: number;
  /** Documents directly under the space root. */
  roots: number;
  childrenPerNode: [number, number];
  /** How deep the tree goes, the roots counted as level one. */
  depth: number;
  blocksPerField: [number, number];
  /** Share of documents that get a translation in every other locale of the space. */
  translated: number;
  /** Share of documents that are published rather than left as drafts. */
  published: number;
  menus: number;
  credentials: number;
  webhooks: number;
  workflows: number;
}

const SMALL: Scale = {
  spaces: 1,
  locales: ['en', 'de'],
  blockTypes: 6,
  contentTypes: 5,
  fieldsPerType: [6, 12],
  assets: 12,
  templates: 3,
  roots: 6,
  childrenPerNode: [2, 4],
  depth: 3,
  blocksPerField: [1, 4],
  translated: 0.3,
  published: 0.7,
  menus: 2,
  credentials: 3,
  webhooks: 5,
  workflows: 6,
};

const MEDIUM: Scale = {
  ...SMALL,
  spaces: 2,
  locales: ['en', 'de', 'fr'],
  blockTypes: 12,
  contentTypes: 10,
  fieldsPerType: [10, 20],
  assets: 40,
  templates: 8,
  roots: 12,
  childrenPerNode: [3, 5],
  depth: 4,
  blocksPerField: [2, 8],
  menus: 5,
  credentials: 6,
  webhooks: 14,
  workflows: 16,
};

const LARGE: Scale = {
  ...MEDIUM,
  spaces: 3,
  locales: ['en', 'de', 'fr', 'es'],
  blockTypes: 20,
  contentTypes: 18,
  fieldsPerType: [14, 26],
  assets: 80,
  templates: 16,
  roots: 20,
  childrenPerNode: [4, 7],
  depth: 4,
  blocksPerField: [3, 12],
  translated: 0.5,
  menus: 8,
  credentials: 10,
  webhooks: 24,
  workflows: 32,
};

const PRESETS: Record<string, Scale> = { small: SMALL, medium: MEDIUM, large: LARGE };

const number = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** The preset `SEED_SCALE` names, with any `SEED_*` override applied on top. */
export function resolveScale(): { name: string; scale: Scale } {
  const name = process.env.SEED_SCALE ?? 'medium';
  const preset = PRESETS[name];
  if (!preset) {
    throw new Error(`unknown SEED_SCALE "${name}"; one of ${Object.keys(PRESETS).join(', ')}`);
  }

  const locales = process.env.SEED_LOCALES?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return {
    name,
    scale: {
      ...preset,
      ...(locales?.length ? { locales } : {}),
      spaces: number('SEED_SPACES', preset.spaces),
      blockTypes: number('SEED_BLOCK_TYPES', preset.blockTypes),
      contentTypes: number('SEED_CONTENT_TYPES', preset.contentTypes),
      assets: number('SEED_ASSETS', preset.assets),
      templates: number('SEED_TEMPLATES', preset.templates),
      roots: number('SEED_ROOTS', preset.roots),
      depth: number('SEED_DEPTH', preset.depth),
      menus: number('SEED_MENUS', preset.menus),
      credentials: number('SEED_CREDENTIALS', preset.credentials),
      webhooks: number('SEED_WEBHOOKS', preset.webhooks),
      workflows: number('SEED_WORKFLOWS', preset.workflows),
    },
  };
}
