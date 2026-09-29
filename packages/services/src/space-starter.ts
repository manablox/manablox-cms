import { randomUUID } from 'node:crypto';
import {
  type ContentTypeDefinition,
  ManabloxError,
  type SpaceBlockId,
  type SpaceTemplateId,
} from '@manablox/core';
import type { ContentRow, Repositories, SpaceRow } from '@manablox/db';
import type { ContentService } from './content/service.js';
import type { Actor } from './content/types.js';
import type { ContentTypeService } from './content-type.service.js';
import type { MenuService } from './menu.service.js';
import type { SpaceService } from './space.service.js';
import { spaceTemplateModel } from './space-templates/index.js';
import type { SpaceTemplate, TemplateRefs } from './space-templates/shared.js';

/** Services, so every row gets its hooks and audit entry. */
export interface SpaceStarterServices {
  /** Opens the starter's transaction; a transaction's repositories nest it in that one. */
  repos: Repositories;
  contentTypes: ContentTypeService;
  content: ContentService;
  menus: MenuService;
  spaces: SpaceService;
}

export interface SpaceStarterResult {
  contentTypes: number;
  contents: number;
  menus: number;
  homeContentId: string;
}

/**
 * Fills a new space with a website type's content model, published documents (with a home as
 * root) and a main menu, through the services, in one transaction. `blocks` are the picked
 * catalog blocks of the `custom` type.
 */
export async function applySpaceStarter(
  services: SpaceStarterServices,
  space: SpaceRow,
  actor: Actor | null,
  template: SpaceTemplateId = 'basic',
  blocks?: readonly SpaceBlockId[],
): Promise<SpaceStarterResult> {
  const model = spaceTemplateModel(template, blocks);
  await assertStarterLimits(services, space.id, model);
  return services.repos.transaction((tx) =>
    fill(
      {
        repos: tx,
        contentTypes: services.contentTypes.using(tx),
        content: services.content.using(tx),
        menus: services.menus.using(tx),
        spaces: services.spaces.using(tx),
      },
      space,
      actor,
      model,
    ),
  );
}

/** Count limits for the whole template, before anything is written. */
async function assertStarterLimits(
  services: SpaceStarterServices,
  spaceId: string,
  template: SpaceTemplate,
): Promise<void> {
  await services.contentTypes.assertTypeLimits(
    spaceId,
    template.types.map((type) => type.kind ?? 'content'),
  );
  const kinds = new Map(template.types.map((type) => [type.name, type.kind ?? 'content']));
  for (const kind of ['content', 'data'] as const) {
    const count = template.documents.filter((doc) => kinds.get(doc.type) === kind).length;
    await services.content.assertCountLimit(spaceId, kind, count);
  }
}

async function fill(
  services: SpaceStarterServices,
  space: SpaceRow,
  actor: Actor | null,
  template: SpaceTemplate,
): Promise<SpaceStarterResult> {
  const createdBy = actor?.userId ?? null;

  // Global code types shadow these names, so refuse before writing anything.
  const wanted = template.types.map((type) => type.name);
  const taken = services.contentTypes
    .list(space.id)
    .filter((type) => wanted.includes(type.name))
    .map((type) => type.name);
  if (taken.length) throw ManabloxError.conflict('space.starter.typeTaken', { names: taken });

  // Names in `settings.types` become the ids of the types created before.
  const types = new Map<string, ContentTypeDefinition>();
  const typeId = (name: string) => (types.get(name) as ContentTypeDefinition).id;
  for (const input of template.types) {
    const fields = input.fields.map((field) => {
      const settings = field.settings as { types?: string[] } | undefined;
      return settings?.types
        ? { ...field, settings: { ...settings, types: settings.types.map(typeId) } }
        : field;
    });
    const created = await services.contentTypes.create(
      { ...input, fields, spaceId: space.id },
      createdBy,
    );
    types.set(input.name, created);
  }

  const rows = new Map<string, ContentRow>();
  const refs: TemplateRefs = {
    space,
    doc: (key) => (rows.get(key) as ContentRow).id,
    hasDoc: (key) => rows.has(key),
    type: typeId,
    block: (type, fields, layout) => ({
      blockId: randomUUID(),
      type: typeId(type),
      fields,
      ...(layout ? { layout } : {}),
    }),
  };
  const siblings = new Map<string, number>();
  for (const doc of template.documents) {
    const parentId = doc.parent ? refs.doc(doc.parent) : null;
    const place = parentId ?? '';
    const position = doc.position ?? siblings.get(place) ?? 0;
    if (doc.slug !== undefined) siblings.set(place, (siblings.get(place) ?? 0) + 1);
    const row = await services.content.create(
      {
        spaceId: space.id,
        typeId: typeId(doc.type),
        locale: space.defaultLocale,
        title: doc.title,
        ...(doc.slug !== undefined ? { slug: doc.slug, position } : {}),
        ...(parentId ? { parentId } : {}),
        fields: doc.fields(refs),
      },
      actor,
    );
    rows.set(doc.key, row);
  }

  for (const row of rows.values()) await services.content.publish(space.id, row.id, actor);
  const home = rows.get(template.home) as ContentRow;
  await services.spaces.setHome(space.id, home.id);

  // No menu while menus are off.
  const withMenu = await services.menus.editable(space.id);
  if (withMenu) {
    const menu = await services.menus.create({
      spaceId: space.id,
      name: 'Main navigation',
      machineName: 'main',
      description: 'The links in the site header.',
    });
    await services.menus.setItems(
      space.id,
      menu.id,
      template.menu.map((key) => ({
        localizationId: (rows.get(key) as ContentRow).localizationId,
      })),
    );
  }

  return {
    contentTypes: types.size,
    contents: rows.size,
    menus: withMenu ? 1 : 0,
    homeContentId: home.id,
  };
}
