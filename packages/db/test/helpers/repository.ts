/** Repository test fixtures. */
import {
  type ContentTypeDefinition,
  ContentTypeRegistry,
  defineContentType,
  defineFieldType,
  FieldTypeRegistry,
  type StandardSchemaV1,
} from '@manablox/core';
import { createDatabase, type DatabaseHandle } from '../../src/client.js';
import { createRepositories, type Repositories } from '../../src/repositories/index.js';
import { createTestDatabase } from '../../src/testing.js';

const anySchema = <T>(): StandardSchemaV1<unknown, T> => ({
  '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value: value as T }) },
});

const stringField = defineFieldType({
  name: 'string',
  label: 'Text',
  settingsSchema: anySchema<Record<string, unknown>>(),
  valueSchema: () => anySchema<string>(),
  defaultValue: () => '',
  storage: { kind: 'jsonb', index: 'btree' },
  filters: ['eq', 'neq', 'contains', 'startsWith', 'in', 'isNull', 'isNotNull'],
  graphql: { type: { kind: 'scalar', name: 'String' } },
  search: (value) => (typeof value === 'string' ? value : null),
  admin: { input: 'string' },
});

const numberField = defineFieldType({
  name: 'number',
  label: 'Number',
  settingsSchema: anySchema<Record<string, unknown>>(),
  valueSchema: () => anySchema<number>(),
  defaultValue: () => 0,
  storage: { kind: 'jsonb', index: 'btree' },
  filters: ['eq', 'lt', 'lte', 'gt', 'gte'],
  graphql: { type: { kind: 'scalar', name: 'Float' } },
  admin: { input: 'number' },
});

export interface RepositoryTestContext {
  /** The suite's database, for a second connection to it. */
  url: string;
  handle: DatabaseHandle;
  /** Every statement sent to the database. */
  queries: string[];
  repos: Repositories;
  registry: ContentTypeRegistry;
  types: { page: ContentTypeDefinition; folder: ContentTypeDefinition };
  spaceId: string;
  /** The space's production environment. */
  environmentId: string;
  close: () => Promise<void>;
}

/** An isolated migrated database per suite. */
export async function createRepositoryContext(name: string): Promise<RepositoryTestContext> {
  const database = await createTestDatabase(name);
  const queries: string[] = [];
  const handle = await createDatabase(
    { url: database.url, max: 4 },
    { onQuery: (query) => queries.push(query) },
  );

  const fieldTypes = new FieldTypeRegistry();
  fieldTypes.register(stringField);
  fieldTypes.register(numberField);

  const page = defineContentType({
    name: 'page',
    fields: [
      { name: 'body', type: 'string' },
      { name: 'weight', type: 'number' },
    ],
  });
  // Slug-less, so transparent in descendants' permalinks.
  const folder = defineContentType({
    name: 'folder',
    hasSlug: false,
    fields: [{ name: 'note', type: 'string' }],
  });

  const registry = new ContentTypeRegistry(fieldTypes);
  registry.setAll([page, folder]);
  registry.validate();

  const repos = createRepositories(handle, registry);
  const space = await repos.spaces.create({
    name: 'Test',
    machineName: 'test',
    url: 'http://localhost:3002',
  });

  return {
    url: database.url,
    handle,
    queries,
    repos,
    registry,
    types: { page, folder },
    spaceId: space.id,
    environmentId: (await repos.environments.production(space.id))?.id as string,
    close: async () => {
      await handle.close();
      await database.drop();
    },
  };
}

/** Creates a node with minimal input. */
export async function makeNode(
  ctx: RepositoryTestContext,
  options: {
    title: string;
    slug: string;
    parentId?: string | null;
    type?: 'page' | 'folder';
    fields?: Record<string, unknown>;
  },
) {
  const type = ctx.types[options.type ?? 'page'];
  // Mirrors the content service's `searchText` derivation.
  const searchText = Object.values(options.fields ?? {})
    .filter((value): value is string => typeof value === 'string')
    .join(' ');

  return ctx.repos.content.create({
    searchText,
    spaceId: ctx.spaceId,
    typeId: type.id,
    locale: 'en',
    parentId: options.parentId ?? null,
    title: options.title,
    slug: options.slug,
    fields: options.fields ?? {},
    hasSlug: type.hasSlug,
  });
}
