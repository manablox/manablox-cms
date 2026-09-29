/** Dependency ranges the scaffolds write; `test/versions.test.ts` holds them to the workspace catalog. */
export const VERSIONS = {
  // The engines floor (`node >=24`), not the repo's newer Node.
  '@types/node': '^24.0.0',
  typescript: '^7.0.2',
  vite: '^8.2.2',
  vue: '^3.5.42',
  'vue-router': '^5.3.1',
  'vue-tsc': '^3.3.11',
  '@vitejs/plugin-vue': '^6.0.8',
  astro: '^7.3.1',
  '@astrojs/check': '^0.9.10',
  // Not in the catalog.
  '@astrojs/node': '^11.1.5',
  react: '^19.2.0',
  'react-dom': '^19.2.0',
  '@types/react': '^19.2.0',
  '@types/react-dom': '^19.2.0',
  '@vitejs/plugin-react': '^5.0.0',
  express: '^5.1.0',
  '@types/express': '^5.0.0',
} as const;

/** Catalog entries the scaffolds deliberately stay below. */
export const BELOW_CATALOG: readonly (keyof typeof VERSIONS)[] = ['@types/node'];

/** `vue-tsc` and `astro check` drive TypeScript's JS API, which 7.x lacks; as the named catalogs. */
export const TYPESCRIPT_FOR = {
  vue: '^5.9.3',
  astro: '^6.0.3',
} as const;
