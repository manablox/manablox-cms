import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/sqlite/schema/index.ts',
  out: './migrations-sqlite',
  dialect: 'sqlite',
  casing: 'snake_case',
});
